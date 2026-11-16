"""Bounded public source snapshots with atomic publication in tenant storage."""

import asyncio
import fcntl
import io
import os
import re
import shutil
import stat
import tempfile
import zipfile
import zlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import httpx

from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.domain.repositories import Repository

FULL_NAME_PATTERN = r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$"
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

    def __init__(self, storage: Path, *, client: httpx.AsyncClient | None = None) -> None:
        self.storage = storage.expanduser().resolve()
        self.client = client or httpx.AsyncClient(timeout=15, follow_redirects=False)
        self.owns_client = client is None
        self.slots = asyncio.Semaphore(2)

    async def aclose(self) -> None:
        if self.owns_client:
            await self.client.aclose()

    async def import_public(self, full_name: str, user_id: UUID) -> ImportedSnapshot:
        """Validate visibility, pin the default revision and download within a deadline."""
        async with self._operation():
            name, repository_id = await self._public_repository(full_name)
            commit = await self._default_commit(name)
            return await self._download_snapshot(user_id, repository_id, name, commit)

    async def latest_commit(self, repository: Repository) -> str:
        """Read the default branch tip of the same registered public repository."""
        async with self._operation():
            name, _ = await self._registered_public_repository(repository)
            return await self._default_commit(name)

    async def sync_public(self, repository: Repository) -> ImportedSnapshot | None:
        """Import the latest revision only if it differs from the saved snapshot."""
        async with self._operation():
            name, repository_id = await self._registered_public_repository(repository)
            latest = await self._default_commit(name)
            if latest == repository.github_commit:
                return None
            return await self._download_snapshot(
                repository.owner_user_id, repository_id, name, latest, verify_existing=True
            )

    async def verify_saved(self, repository: Repository) -> ResolvedLocalRepositoryRoot:
        """Verify a stale binding against a fresh archive of the original public commit."""
        commit = repository.github_commit
        if commit is None or repository.root_inode is None:
            raise GitHubImportError("This snapshot cannot be verified.")
        async with self._operation():
            name, repository_id = await self._registered_public_repository(repository)
            snapshot = await self._download_snapshot(
                repository.owner_user_id, repository_id, name, commit, verify=repository
            )
            return snapshot.root

    async def _registered_public_repository(self, repository: Repository) -> tuple[str, int]:
        commit = repository.github_commit
        if (
            repository.github_full_name is None
            or not commit
            or not re.fullmatch(r"[a-f0-9]{40}", commit)
        ):
            raise GitHubImportError("This GitHub snapshot has no valid saved revision.")
        name, repository_id = await self._public_repository(repository.github_full_name)
        registered_path = self.storage / str(repository.owner_user_id) / str(repository_id) / commit
        if str(registered_path) != repository.canonical_root:
            raise GitHubImportError("GitHub no longer matches the saved repository registration.")
        return name, repository_id

    async def _public_repository(self, full_name: str) -> tuple[str, int]:
        if not re.fullmatch(FULL_NAME_PATTERN, full_name) or full_name.split("/")[1] in {".", ".."}:
            raise GitHubImportError("Choose an available public GitHub repository.")
        metadata = await self.client.get(
            f"https://api.github.com/repos/{full_name}",
            headers={"Accept": "application/vnd.github+json"},
        )
        metadata.raise_for_status()
        repo = metadata.json()
        if (
            not isinstance(repo, dict)
            or repo.get("private") is not False
            or repo.get("visibility") != "public"
            or type(repo.get("id")) is not int
            or repo["id"] <= 0
            or not isinstance(repo.get("full_name"), str)
            or not re.fullmatch(FULL_NAME_PATTERN, repo["full_name"])
            or repo["full_name"].lower() != full_name.lower()
        ):
            raise GitHubImportError("Choose an available public GitHub repository.")
        return str(repo["full_name"]), int(repo["id"])

    async def _default_commit(self, name: str) -> str:
        revision = await self.client.get(
            f"https://api.github.com/repos/{name}/commits",
            params={"per_page": 1},
            headers={"Accept": "application/vnd.github+json"},
        )
        revision.raise_for_status()
        revisions = revision.json()
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
        repository_id: int,
        name: str,
        commit: str,
        *,
        verify: Repository | None = None,
        verify_existing: bool = False,
    ) -> ImportedSnapshot:
        payload = bytearray()
        async with self.client.stream(
            "GET", f"https://codeload.github.com/{name}/zip/{commit}"
        ) as response:
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
                repository_id,
                name,
                commit,
                verify,
                verify_existing,
            )
        )
        try:
            return await asyncio.shield(publication)
        except asyncio.CancelledError:
            # Keep the slot until bounded filesystem work and cleanup finish.
            # Cancelling to_thread alone does not stop its worker thread.
            await publication
            raise

    @asynccontextmanager
    async def _operation(self) -> AsyncIterator[None]:
        try:
            async with asyncio.timeout(60), self.slots:
                yield
        except GitHubImportError:
            raise
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            messages = {
                404: "GitHub could not find this public repository (HTTP 404).",
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
    ) -> ImportedSnapshot:
        parent = self.storage / str(user_id) / str(repository_id)
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
