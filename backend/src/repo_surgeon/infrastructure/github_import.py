"""Bounded public source snapshots with atomic publication in tenant storage."""

import asyncio
import fcntl
import io
import re
import shutil
import stat
import tempfile
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import httpx

from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot

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
            raise GitHubImportError("Repository exceeds the file limit.")
        total = 0
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
            total += entry.file_size
            if total > MAX_SOURCE_BYTES:
                raise GitHubImportError("Repository exceeds the source size limit.")
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
                        raise GitHubImportError("Repository exceeds the source size limit.")
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
        if not re.fullmatch(FULL_NAME_PATTERN, full_name) or full_name.split("/")[1] in {".", ".."}:
            raise GitHubImportError("Choose an available public GitHub repository.")
        try:
            async with asyncio.timeout(60), self.slots:
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
                ):
                    raise GitHubImportError("Choose an available public GitHub repository.")
                name = repo["full_name"]
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
                payload = bytearray()
                async with self.client.stream(
                    "GET", f"https://codeload.github.com/{name}/zip/{commit}"
                ) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes(64 * 1024):
                        payload.extend(chunk)
                        if len(payload) > MAX_ARCHIVE_BYTES:
                            raise GitHubImportError("Repository archive exceeds 25 MiB.")
                # The deterministic destination makes retries and concurrent imports converge.
                publication = asyncio.create_task(
                    asyncio.to_thread(
                        self._publish, bytes(payload), user_id, repo["id"], name, commit
                    )
                )
                try:
                    return await asyncio.shield(publication)
                except asyncio.CancelledError:
                    # Keep the slot until bounded filesystem work and cleanup finish.
                    # Cancelling to_thread alone does not stop its worker thread.
                    await publication
                    raise
        except GitHubImportError:
            raise
        except (
            httpx.HTTPError,
            TimeoutError,
            ValueError,
            TypeError,
            OSError,
            zipfile.BadZipFile,
            zlib.error,
        ):
            raise GitHubImportError("Import failed. Check the repository and try again.") from None

    def _publish(
        self, archive: bytes, user_id: UUID, repository_id: int, name: str, commit: str
    ) -> ImportedSnapshot:
        parent = self.storage / str(user_id) / str(repository_id)
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if parent.resolve() != parent:
            raise GitHubImportError("Repository storage is unavailable.")
        destination = parent / commit
        staging = Path(tempfile.mkdtemp(prefix=".import-", dir=parent))
        try:
            extract_snapshot(archive, staging)
            with (parent / ".publish.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
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
