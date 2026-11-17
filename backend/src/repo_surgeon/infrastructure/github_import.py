"""Bounded public source snapshots with atomic publication in tenant storage."""

import asyncio
import fcntl
import io
import json
import os
import re
import shutil
import stat
import tempfile
import zipfile
import zlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import UUID

import httpx

from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.domain.authentication import LOCAL_DEVELOPMENT_USER_ID
from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.infrastructure.github_app import (
    GITHUB_API_HEADERS,
    GitHubAppError,
    GitHubAppInstallation,
)
from repo_surgeon.infrastructure.github_pull_requests import (
    MAX_PULL_REQUEST_FILE_PAGE,
    MAX_PULL_REQUEST_FILES,
    PULL_REQUEST_FILE_PAGE_SIZE,
    PULL_REQUEST_PAGE_SIZE,
    GitHubPullRequestChanges,
    GitHubPullRequestPage,
    change_count,
    pull_file_from_github,
    pull_request_from_github,
)

FULL_NAME_PATTERN = r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$"
COMMIT_PATTERN = r"^[a-f0-9]{40}$"
HISTORY_PAGE_SIZE = 25
MAX_HISTORY_PAGE = 1000
MAX_HISTORY_BYTES = 1024 * 1024
MAX_HISTORY_SNAPSHOTS = 3
MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_FILES = 10_000


class GitHubImportError(Exception):
    """Import failed without granting a repository capability."""


@dataclass(frozen=True)
class ImportedSnapshot:
    """An atomically published source directory and verified upstream identity."""

    root: ResolvedLocalRepositoryRoot
    full_name: str
    commit: str


@dataclass(frozen=True)
class _UpstreamRepository:
    name: str
    id: int
    default_branch: str | None
    private: bool
    token: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class GitHubBranchPage:
    default_branch: str
    branches: list[str]
    next_page: int | None


@dataclass(frozen=True)
class GitHubCommit:
    sha: str
    message: str


@dataclass(frozen=True)
class GitHubCommitPage:
    commits: list[GitHubCommit]
    next_page: int | None


def extract_snapshot(archive: bytes, destination: Path) -> None:
    """Extract regular files only, validating all paths and expanded sizes first."""
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        entries = source.infolist()
        if not entries or len(entries) > MAX_FILES:
            raise GitHubImportError(
                f"Archive contains {len(entries):,} entries; the limit is {MAX_FILES:,}."
            )
        total = sum(entry.file_size for entry in entries)
        if total > MAX_SOURCE_BYTES:
            raise GitHubImportError(
                f"Expanded source is {total:,} bytes; "
                f"the source size limit is {MAX_SOURCE_BYTES:,} bytes (100 MiB)."
            )
        roots: set[str] = set()
        paths: set[str] = set()
        for entry in entries:
            parts = entry.filename.rstrip("/").split("/")
            if (
                len(parts) > 64
                or len(entry.filename) > 1024
                or any(part.casefold() in {"", ".", "..", ".git"} for part in parts)
                or any("\\" in part or ":" in part or "\x00" in part for part in parts)
            ):
                raise GitHubImportError("Repository archive contains an unsafe path.")
            roots.add(parts[0])
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise GitHubImportError("Repository contains unsupported links or special files.")
            if entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                raise GitHubImportError("Repository archive compression is unsupported.")
            if entry.flag_bits & 1:
                raise GitHubImportError("Encrypted archives are unsupported.")
            key = entry.filename.rstrip("/").casefold()
            if key in paths:
                raise GitHubImportError("Repository contains conflicting file names.")
            paths.add(key)

        if len(roots) != 1:
            raise GitHubImportError("Repository archive has multiple roots.")
        written = 0
        for entry in entries:
            relative = entry.filename.rstrip("/").split("/")[1:]
            if not relative:
                if not entry.is_dir():
                    raise GitHubImportError("Repository archive has no root directory.")
                continue
            target = destination.joinpath(*relative)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as input_file, target.open("xb") as output:
                while chunk := input_file.read(64 * 1024):
                    written += len(chunk)
                    if written > MAX_SOURCE_BYTES:
                        raise GitHubImportError(
                            f"Source size limit exceeded ({MAX_SOURCE_BYTES:,} bytes); "
                            f"at least {written:,} bytes were measured."
                        )
                    output.write(chunk)


class GitHubImporter:
    """Only fixed GitHub endpoints may supply data to the importer."""

    def __init__(
        self,
        storage: Path,
        *,
        client: httpx.AsyncClient | None = None,
        installation: GitHubAppInstallation | None = None,
    ) -> None:
        self.storage = storage.expanduser().resolve()
        self.client = client or httpx.AsyncClient(timeout=15, follow_redirects=False)
        self.owns_client = client is None
        self.slots = asyncio.Semaphore(2)
        self.installation = installation

    async def aclose(self) -> None:
        if self.owns_client:
            await self.client.aclose()

    async def import_public(self, full_name: str, user_id: UUID) -> ImportedSnapshot:
        """Validate visibility, pin the default revision and download within a deadline."""
        async with self._operation():
            upstream = await self._fetch_repository(full_name)
            commit = await self._default_commit(upstream)
            return await self._download_snapshot(user_id, upstream, commit)

    async def latest_commit(self, repository: Repository) -> str:
        """Read the default branch tip of the same registered repository."""
        async with self._operation():
            upstream = await self._registered_repository(repository)
            return await self._default_commit(upstream)

    async def sync_registered(self, repository: Repository) -> ImportedSnapshot | None:
        """Import the latest revision only if it differs from the saved snapshot."""
        async with self._operation():
            upstream = await self._registered_repository(repository)
            latest = await self._default_commit(upstream)
            if latest == repository.github_commit:
                return None
            return await self._download_snapshot(
                repository.owner_user_id,
                upstream,
                latest,
                verify_existing=True,
            )

    async def verify_saved(self, repository: Repository) -> ResolvedLocalRepositoryRoot:
        """Verify a stale binding against a fresh archive of the original commit."""
        commit = repository.github_commit
        if commit is None or repository.root_inode is None:
            raise GitHubImportError("This snapshot cannot be verified.")
        async with self._operation():
            upstream = await self._registered_repository(repository)
            snapshot = await self._download_snapshot(
                repository.owner_user_id, upstream, commit, verify=repository
            )
            return snapshot.root

    async def list_pull_requests(
        self, repository: Repository, state: str, page: int
    ) -> GitHubPullRequestPage:
        async with self._operation():
            upstream = await self._registered_repository(repository)
            token = await self._pull_request_token(upstream)
            payload, more = await self._github_json(
                f"{upstream.name}/pulls",
                {
                    "state": state,
                    "sort": "updated",
                    "page": page,
                    "per_page": PULL_REQUEST_PAGE_SIZE,
                },
                token,
            )
            if not isinstance(payload, list) or len(payload) > PULL_REQUEST_PAGE_SIZE:
                raise ValueError
            return GitHubPullRequestPage(
                [pull_request_from_github(item, upstream.name) for item in payload],
                page + 1 if more and page < MAX_HISTORY_PAGE else None,
            )

    async def pull_request_changes(
        self, repository: Repository, number: int, page: int
    ) -> GitHubPullRequestChanges:
        async with self._operation():
            upstream = await self._registered_repository(repository)
            token = await self._pull_request_token(upstream)
            path = f"{upstream.name}/pulls/{number}"
            try:
                details, _ = await self._github_json(path, {}, token)
                payload, more = await self._github_json(
                    f"{path}/files", {"page": page, "per_page": PULL_REQUEST_FILE_PAGE_SIZE}, token
                )
            except httpx.HTTPStatusError as error:
                if error.response.status_code == 404:
                    raise GitHubImportError(
                        f"GitHub could not find pull request #{number} (HTTP 404)."
                    ) from None
                raise
            if (
                not isinstance(details, dict)
                or change_count(details.get("number")) != number
                or not isinstance(payload, list)
                or len(payload) > PULL_REQUEST_FILE_PAGE_SIZE
            ):
                raise ValueError
            files = [file for item in payload if (file := pull_file_from_github(item)) is not None]
            changed_files = change_count(details.get("changed_files"))
            next_page = page + 1 if more and page < MAX_PULL_REQUEST_FILE_PAGE else None
            return GitHubPullRequestChanges(
                changed_files,
                change_count(details.get("additions")),
                change_count(details.get("deletions")),
                files,
                len(payload) - len(files),
                next_page,
                next_page is None and changed_files > MAX_PULL_REQUEST_FILES,
            )

    async def _pull_request_token(self, upstream: _UpstreamRepository) -> str | None:
        if upstream.private and self.installation is not None:
            return await self.installation.access_token(self.client, permission="pull_requests")
        return None

    async def list_branches(self, repository: Repository, page: int) -> GitHubBranchPage:
        async with self._operation():
            upstream = await self._registered_repository(repository)
            if upstream.default_branch is None:
                raise GitHubImportError("GitHub did not provide a default branch.")
            payload, next_page = await self._history_page(
                f"{upstream.name}/branches", page, upstream.token
            )
            branches = []
            for item in payload:
                name = item.get("name") if isinstance(item, dict) else None
                if not isinstance(name, str) or not _valid_branch(name):
                    raise GitHubImportError("GitHub returned an invalid branch name.")
                branches.append(name)
            return GitHubBranchPage(upstream.default_branch, branches, next_page)

    async def list_branch_commits(
        self, repository: Repository, branch: str, page: int
    ) -> GitHubCommitPage:
        async with self._operation():
            upstream = await self._registered_repository(repository)
            return await self._branch_commits(upstream, branch, page)

    async def prepare_history_preview(
        self, repository: Repository, branch: str, page: int, sha: str
    ) -> None:
        """Materialize only a SHA listed on the requested branch; leave registration alone."""
        async with self._operation():
            upstream = await self._registered_repository(repository)
            history = await self._branch_commits(upstream, branch, page)
            if not any(commit.sha == sha for commit in history.commits):
                raise GitHubImportError(
                    "This commit is no longer on the requested history page. "
                    "Reload the commit list."
                )
            parent = self._history_parent(repository)
            if await asyncio.to_thread(_cached_history_root, parent, sha) is None:
                await self._download_snapshot(repository.owner_user_id, upstream, sha, history=True)

    def history_preview_root(
        self, repository: Repository, sha: str
    ) -> ResolvedLocalRepositoryRoot | None:
        """Resolve an already prepared preview for this owner and upstream repository."""
        if re.fullmatch(COMMIT_PATTERN, sha) is None:
            return None
        try:
            return _cached_history_root(self._history_parent(repository), sha)
        except GitHubImportError, OSError:
            return None

    def _history_parent(self, repository: Repository) -> Path:
        parent = self._managed_parent(repository)
        return parent / (
            ".history-app" if self._uses_installation(repository, parent) else ".history"
        )

    def _uses_installation(self, repository: Repository, parent: Path) -> bool:
        return (
            self.installation is not None
            and repository.owner_user_id == LOCAL_DEVELOPMENT_USER_ID
            and parent.name == str(self.installation.repository_id)
        )

    def _managed_parent(self, repository: Repository) -> Path:
        root = Path(repository.canonical_root)
        if (
            repository.source != RepositorySource.GITHUB
            or root.name != repository.github_commit
            or re.fullmatch(COMMIT_PATTERN, root.name) is None
            or root.parent.parent != self.storage / str(repository.owner_user_id)
            or re.fullmatch(r"[1-9][0-9]*", root.parent.name) is None
        ):
            raise GitHubImportError("The saved GitHub snapshot has an invalid storage binding.")
        return root.parent

    async def _branch_commits(
        self, upstream: _UpstreamRepository, branch: str, page: int
    ) -> GitHubCommitPage:
        if not _valid_branch(branch):
            raise GitHubImportError("Choose a valid GitHub branch.")
        metadata, _ = await self._github_json(
            f"{upstream.name}/branches/{quote(branch, safe='')}", {}, upstream.token
        )
        if not isinstance(metadata, dict) or metadata.get("name") != branch:
            raise GitHubImportError("GitHub did not resolve the requested branch.")
        tip = metadata.get("commit")
        sha = tip.get("sha") if isinstance(tip, dict) else None
        if not isinstance(sha, str) or re.fullmatch(COMMIT_PATTERN, sha) is None:
            raise GitHubImportError("GitHub did not provide a valid branch tip.")
        payload, next_page = await self._history_page(
            f"{upstream.name}/commits", page, upstream.token, sha=sha
        )
        commits = []
        for item in payload:
            if not isinstance(item, dict):
                raise GitHubImportError("GitHub returned invalid commit metadata.")
            commit = item.get("commit")
            if not isinstance(commit, dict) or not isinstance(commit.get("message"), str):
                raise GitHubImportError("GitHub returned invalid commit metadata.")
            commit_sha = item.get("sha")
            if not isinstance(commit_sha, str) or re.fullmatch(COMMIT_PATTERN, commit_sha) is None:
                raise GitHubImportError("GitHub returned an invalid commit SHA.")
            commits.append(GitHubCommit(commit_sha, commit["message"]))
        return GitHubCommitPage(commits, next_page)

    async def _history_page(
        self, path: str, page: int, token: str | None, **params: str
    ) -> tuple[list[object], int | None]:
        payload, more = await self._github_json(
            path, {"per_page": HISTORY_PAGE_SIZE, "page": page, **params}, token
        )
        if not isinstance(payload, list) or len(payload) > HISTORY_PAGE_SIZE:
            raise GitHubImportError("GitHub returned invalid history metadata.")
        return payload, page + 1 if more and page < MAX_HISTORY_PAGE else None

    async def _github_json(
        self, path: str, params: dict[str, str | int], token: str | None = None
    ) -> tuple[object, bool]:
        async with self.client.stream(
            "GET",
            f"https://api.github.com/repos/{path}",
            params=params,
            headers=_api_headers(token),
            follow_redirects=False,
        ) as response:
            response.raise_for_status()
            payload = bytearray()
            async for chunk in response.aiter_bytes(64 * 1024):
                if len(payload) + len(chunk) > MAX_HISTORY_BYTES:
                    raise GitHubImportError("GitHub metadata exceeds the 1 MiB response limit.")
                payload.extend(chunk)
            return json.loads(payload), "next" in response.links

    async def _registered_repository(self, repository: Repository) -> _UpstreamRepository:
        parent = self._managed_parent(repository)
        if repository.github_full_name is None:
            raise GitHubImportError("This GitHub snapshot has no saved upstream name.")
        token = None
        if self.installation is not None and self._uses_installation(repository, parent):
            token = await self.installation.access_token(self.client)
        upstream = await self._fetch_repository(repository.github_full_name, token)
        if parent.name != str(upstream.id):
            raise GitHubImportError("GitHub no longer matches the saved repository registration.")
        return upstream

    async def _fetch_repository(
        self, full_name: str, token: str | None = None
    ) -> _UpstreamRepository:
        if not re.fullmatch(FULL_NAME_PATTERN, full_name) or full_name.split("/")[1] in {".", ".."}:
            raise GitHubImportError("Choose an available GitHub repository.")
        repo, _ = await self._github_json(full_name, {}, token)
        if (
            not isinstance(repo, dict)
            or not (
                (repo.get("private") is False and repo.get("visibility") == "public")
                or (
                    token is not None
                    and repo.get("private") is True
                    and repo.get("visibility") == "private"
                )
            )
            or type(repo.get("id")) is not int
            or repo["id"] <= 0
            or not isinstance(repo.get("full_name"), str)
            or not re.fullmatch(FULL_NAME_PATTERN, repo["full_name"])
            or repo["full_name"].lower() != full_name.lower()
        ):
            raise GitHubImportError("Choose an available public GitHub repository.")
        default = repo.get("default_branch")
        return _UpstreamRepository(
            str(repo["full_name"]),
            int(repo["id"]),
            default if isinstance(default, str) and _valid_branch(default) else None,
            repo["private"],
            token,
        )

    async def _default_commit(self, upstream: _UpstreamRepository) -> str:
        revisions, _ = await self._github_json(
            f"{upstream.name}/commits", {"per_page": 1}, upstream.token
        )
        commit = (
            revisions[0].get("sha")
            if isinstance(revisions, list) and revisions and isinstance(revisions[0], dict)
            else None
        )
        if not isinstance(commit, str) or not re.fullmatch(r"[a-f0-9]{40}", commit):
            raise GitHubImportError("The repository has no importable revision.")
        return commit

    async def _download_snapshot(
        self,
        user_id: UUID,
        upstream: _UpstreamRepository,
        commit: str,
        *,
        verify: Repository | None = None,
        verify_existing: bool = False,
        history: bool = False,
    ) -> ImportedSnapshot:
        payload = bytearray()
        url = await self._archive_url(upstream, commit)
        async with self.client.stream("GET", url, follow_redirects=False) as response:
            response.raise_for_status()
            length = response.headers.get("content-length", "")
            if length.isdigit() and int(length) > MAX_ARCHIVE_BYTES:
                raise GitHubImportError(
                    f"Archive download is {int(length):,} bytes; "
                    f"the limit is {MAX_ARCHIVE_BYTES:,} bytes (25 MiB)."
                )
            async for chunk in response.aiter_bytes(64 * 1024):
                payload.extend(chunk)
                if len(payload) > MAX_ARCHIVE_BYTES:
                    raise GitHubImportError(
                        f"Download exceeds the 25 MiB limit ({MAX_ARCHIVE_BYTES:,} bytes). "
                        f"At least {len(payload):,} bytes were received; "
                        "the full archive size is unknown because the download was stopped."
                    )
        # The deterministic destination makes retries and concurrent imports converge.
        publication = asyncio.create_task(
            asyncio.to_thread(
                self._publish,
                bytes(payload),
                user_id,
                upstream.id,
                upstream.name,
                commit,
                verify,
                verify_existing,
                (".history-app" if upstream.token else ".history") if history else None,
            )
        )
        try:
            return await asyncio.shield(publication)
        except asyncio.CancelledError:
            # Keep the slot until bounded filesystem work and cleanup finish.
            # Cancelling to_thread alone does not stop its worker thread.
            await publication
            raise

    async def _archive_url(self, upstream: _UpstreamRepository, commit: str) -> str:
        if upstream.token is None:
            return f"https://codeload.github.com/{upstream.name}/zip/{commit}"
        async with self.client.stream(
            "GET",
            f"https://api.github.com/repos/{upstream.name}/zipball/{commit}",
            headers=_api_headers(upstream.token),
            follow_redirects=False,
        ) as response:
            if response.status_code != 302:
                response.raise_for_status()
                raise GitHubImportError("GitHub did not return an archive download link.")
            location: str = response.headers.get("location", "")
        parsed = urlsplit(location)
        if (
            len(location) > 8192
            or parsed.scheme != "https"
            or parsed.netloc != "codeload.github.com"
            or parsed.fragment
            or parsed.path.lower()
            not in {
                f"/{upstream.name.lower()}/legacy.zip/{commit}",
                f"/{upstream.name.lower()}/zip/{commit}",
            }
        ):
            raise GitHubImportError("GitHub returned an unexpected archive download link.")
        # The temporary signed URL authorizes codeload on its own.
        return location

    @asynccontextmanager
    async def _operation(self) -> AsyncIterator[None]:
        try:
            async with asyncio.timeout(60), self.slots:
                yield
        except GitHubImportError:
            raise
        except GitHubAppError as error:
            raise GitHubImportError(str(error)) from None
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            if status == 403 and (
                error.response.headers.get("x-ratelimit-remaining") == "0"
                or "retry-after" in error.response.headers
            ):
                status = 429
            messages = {
                404: "GitHub could not find this repository with the configured access (HTTP 404).",
                403: "GitHub denied this request (HTTP 403).",
                429: "GitHub's request limit has been reached. Retry after the limit resets.",
                409: "This repository has no commits to import.",
            }
            raise GitHubImportError(
                messages.get(status, f"GitHub returned HTTP {status}. Retry later.")
            ) from None
        except httpx.TimeoutException, TimeoutError:
            raise GitHubImportError("The GitHub request timed out. Please retry.") from None
        except httpx.RequestError:
            raise GitHubImportError(
                "The server could not connect to GitHub. Retry when the connection is available."
            ) from None
        except OSError as error:
            reason = os.strerror(error.errno) if error.errno else "filesystem error"
            raise GitHubImportError(
                f"Snapshot storage failed: {reason}. Contact the service operator."
            ) from None
        except zipfile.BadZipFile, zlib.error:
            raise GitHubImportError("GitHub returned an invalid source archive.") from None
        except ValueError, TypeError:
            raise GitHubImportError("GitHub returned invalid repository metadata.") from None

    def _publish(
        self,
        archive: bytes,
        user_id: UUID,
        repository_id: int,
        name: str,
        commit: str,
        verify: Repository | None = None,
        verify_existing: bool = False,
        history_directory: str | None = None,
    ) -> ImportedSnapshot:
        parent = self.storage / str(user_id) / str(repository_id)
        if history_directory is not None:
            parent /= history_directory
        if parent.resolve() != parent:
            raise GitHubImportError("Repository storage is unavailable.")
        if verify is None:
            parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if parent.resolve() != parent:
            raise GitHubImportError("Repository storage is unavailable.")
        destination = parent / commit
        staging = Path(tempfile.mkdtemp(prefix=".import-", dir=parent))
        try:
            extract_snapshot(archive, staging)
            with (parent / ".publish.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if verify is not None:
                    if str(destination) != verify.canonical_root:
                        raise _snapshot_changed()
                    identity = _verify_snapshot_tree(destination, staging, verify.root_inode)
                elif verify_existing and destination.exists():
                    identity = _verify_snapshot_tree(destination, staging)
                else:
                    if not destination.exists():
                        if history_directory is not None:
                            _prune_history(parent, destination)
                        staging.rename(destination)
                    identity = destination.lstat()
            if not stat.S_ISDIR(identity.st_mode):
                raise GitHubImportError("Repository storage is unavailable.")
            return ImportedSnapshot(
                ResolvedLocalRepositoryRoot(str(destination), identity.st_dev, identity.st_ino),
                name,
                commit,
            )
        finally:
            shutil.rmtree(staging, ignore_errors=True)


def _api_headers(token: str | None) -> dict[str, str]:
    if token is None:
        return GITHUB_API_HEADERS
    return {**GITHUB_API_HEADERS, "Authorization": f"Bearer {token}"}


def _valid_branch(name: str) -> bool:
    # Reject path components which would be normalized while constructing the fixed API URL.
    return (
        1 <= len(name) <= 255
        and not any(part in {"", ".", ".."} for part in name.split("/"))
        and not any(ord(char) < 32 or ord(char) == 127 for char in name)
    )


def _cached_history_root(parent: Path, sha: str) -> ResolvedLocalRepositoryRoot | None:
    if parent.resolve() != parent:
        return None
    destination = parent / sha
    try:
        identity = destination.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISDIR(identity.st_mode):
        return None
    return ResolvedLocalRepositoryRoot(str(destination), identity.st_dev, identity.st_ino)


def _prune_history(parent: Path, keep: Path) -> None:
    # Only remove previews under the publisher's lock. Saved snapshot directories are siblings.
    candidates = []
    for child in parent.iterdir():
        if child == keep or re.fullmatch(COMMIT_PATTERN, child.name) is None:
            continue
        identity = child.lstat()
        if stat.S_ISDIR(identity.st_mode):
            candidates.append((identity.st_mtime_ns, child))
    for _, expired in sorted(candidates)[: max(0, len(candidates) + 1 - MAX_HISTORY_SNAPSHOTS)]:
        shutil.rmtree(expired)


def _snapshot_changed() -> GitHubImportError:
    return GitHubImportError(
        "The saved files could not be matched to this GitHub revision. "
        "Import a fresh snapshot or contact the service operator."
    )


def _verify_snapshot_tree(
    destination: Path, expected: Path, expected_inode: int | None = None
) -> os.stat_result:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(destination, flags)
    try:
        identity = os.fstat(descriptor)
        if expected_inode is not None and identity.st_ino != expected_inode:
            raise _snapshot_changed()
        _compare_directory(descriptor, expected, identity.st_dev)
        current = destination.lstat()
        if (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
            raise _snapshot_changed()
        return identity
    finally:
        os.close(descriptor)


def _compare_directory(descriptor: int, expected: Path, device: int) -> None:
    # The upstream archive has already bounded these names, depth and bytes.
    remaining = {entry.name: entry for entry in expected.iterdir()}
    with os.scandir(descriptor) as entries:
        for entry in entries:
            match = remaining.pop(entry.name, None)
            if match is None:
                raise _snapshot_changed()
            directory = match.is_dir()
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if directory:
                flags |= os.O_DIRECTORY
            else:
                info = entry.stat(follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode):
                    raise _snapshot_changed()
            child = os.open(entry.name, flags, dir_fd=descriptor)
            try:
                info = os.fstat(child)
                if info.st_dev != device:
                    raise _snapshot_changed()
                if directory:
                    _compare_directory(child, match, device)
                else:
                    _compare_file(child, match, info)
            finally:
                os.close(child)
    if remaining:
        raise _snapshot_changed()


def _compare_file(descriptor: int, expected: Path, info: os.stat_result) -> None:
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or info.st_size != expected.stat().st_size
    ):
        raise _snapshot_changed()
    with os.fdopen(descriptor, "rb", closefd=False) as current, expected.open("rb") as original:
        while chunk := original.read(64 * 1024):
            if current.read(len(chunk)) != chunk:
                raise _snapshot_changed()
        if current.read(1):
            raise _snapshot_changed()
    after = os.fstat(descriptor)
    if (after.st_ctime_ns, after.st_mtime_ns) != (info.st_ctime_ns, info.st_mtime_ns):
        raise _snapshot_changed()
