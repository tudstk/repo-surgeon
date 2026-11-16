"""Bounded, read-only inspection services for registered repositories."""

from __future__ import annotations

import codecs
import fnmatch
import hashlib
import os
import re
import stat
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Literal

MAX_FILE_COUNT = 200
MAX_DIRECTORY_COUNT = 2_000
MAX_FILE_BYTES = 64 * 1024
MAX_LINE_COUNT = 200
MAX_PREVIEW_LINES = 500
BROWSER_PAGE_SIZE = 100
BROWSER_SCAN_LIMIT = 10_000
_PRIVATE_KEY_HEADER = re.compile(
    r"^[ \t]*(?:-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|PuTTY-User-Key-File-[23]:)",
    re.MULTILINE,
)


@dataclass(frozen=True, slots=True)
class RepositoryFileError(Exception):
    """A stable, content-free error suitable for an untrusted caller."""

    code: str
    detail: str


def normalize_repository_relative_path(request_path: str) -> str:
    """Normalize a safe relative spelling without touching the filesystem."""
    if "\0" in request_path:
        raise RepositoryFileError("unsafe_path", "The requested path is outside the repository.")
    supplied = PurePath(request_path)
    if not request_path or supplied.is_absolute() or ".." in supplied.parts:
        raise RepositoryFileError("unsafe_path", "The requested path is outside the repository.")
    return Path(*supplied.parts).as_posix()


@dataclass(frozen=True, slots=True)
class FileEntry:
    path: str
    entry_type: Literal["file"]
    size_bytes: int


@dataclass(frozen=True, slots=True)
class FileListing:
    directory: str
    entries: tuple[FileEntry, ...]
    truncated: bool

    def audit_summary(self) -> dict[str, object]:
        return {
            "operation": "list_files",
            "directory": self.directory,
            "result_count": len(self.entries),
            "truncated": self.truncated,
        }


@dataclass(frozen=True, slots=True)
class DirectoryEntry:
    name: str
    path: str
    kind: Literal["directory", "file"]


@dataclass(frozen=True, slots=True)
class DirectoryPage:
    entries: tuple[DirectoryEntry, ...]
    next_offset: int | None
    scan_limit_reached: bool


@dataclass(frozen=True, slots=True)
class NumberedLine:
    number: int
    text: str


@dataclass(frozen=True, slots=True)
class FileRead:
    path: str
    start_line: int
    end_line: int
    lines: tuple[NumberedLine, ...]
    truncated: bool
    content_sha256: str

    def audit_summary(self) -> dict[str, object]:
        return {
            "operation": "read_file",
            "path": self.path,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "line_count": len(self.lines),
            "truncated": self.truncated,
            "content_sha256": self.content_sha256,
        }


class ConfinedRepositoryFiles:
    """Read only regular files that resolve under one canonical repository root."""

    def __init__(
        self, canonical_root: str, expected_root_identity: tuple[int, int] | None = None
    ) -> None:
        try:
            self._root = Path(canonical_root).resolve(strict=True)
        except OSError as error:
            raise RepositoryFileError(
                "repository_unavailable", "The registered repository is unavailable."
            ) from error
        if not self._root.is_dir():
            raise RepositoryFileError(
                "repository_unavailable", "The registered repository is unavailable."
            )
        try:
            root_stat = self._root.stat(follow_symlinks=False)
        except OSError as error:
            raise RepositoryFileError(
                "repository_unavailable", "The registered repository is unavailable."
            ) from error
        if (
            expected_root_identity is not None
            and (
                root_stat.st_dev,
                root_stat.st_ino,
            )
            != expected_root_identity
        ):
            raise RepositoryFileError(
                "repository_unavailable", "The registered repository changed."
            )
        self._root_identity = (root_stat.st_dev, root_stat.st_ino)

    @property
    def canonical_root(self) -> Path:
        return self._root

    @property
    def root_identity(self) -> tuple[int, int]:
        return self._root_identity

    def list_files(
        self,
        directory: str = ".",
        glob: str | None = None,
        max_results: int = 50,
        ignored_directories: frozenset[str] = frozenset(),
    ) -> FileListing:
        """Return safe regular files below a confined directory using a fixed walk."""
        visible_directory, normalized_directory = self._resolve_directory(directory)
        limit = min(max_results, MAX_FILE_COUNT)
        entries: list[FileEntry] = []
        visited_directories = 0
        for current_root, directories, files in os.walk(visible_directory, followlinks=False):
            visited_directories += 1
            if visited_directories > MAX_DIRECTORY_COUNT:
                return FileListing(normalized_directory, tuple(entries), truncated=True)
            current = Path(current_root)
            directories[:] = sorted(
                child
                for child in directories
                if child.lower() not in ignored_directories
                and self._is_visible_directory(current / child)
            )
            for filename in sorted(files):
                try:
                    resolved, relative = self._resolve_file_candidate(current / filename)
                except RepositoryFileError:
                    continue
                if glob is not None and not fnmatch.fnmatch(relative, glob):
                    continue
                try:
                    size = resolved.stat().st_size
                except OSError:
                    continue
                if len(entries) == limit:
                    return FileListing(normalized_directory, tuple(entries), truncated=True)
                entries.append(FileEntry(path=relative, entry_type="file", size_bytes=size))
        return FileListing(normalized_directory, tuple(entries), truncated=False)

    def browse_directory(self, directory: str, offset: int) -> DirectoryPage:
        """List one directory without following links or walking descendants."""
        _, relative = self._resolve_requested_path(directory)
        entries: list[DirectoryEntry] = []
        scan_limit_reached = False
        try:
            with ExitStack() as descriptors:
                descriptor = self._open_directory(Path(relative).parts, descriptors)
                children = descriptors.enter_context(os.scandir(descriptor))
                for index, child in enumerate(children):
                    if index == BROWSER_SCAN_LIMIT:
                        scan_limit_reached = True
                        break
                    path = (Path(relative) / child.name).as_posix()
                    if len(path) > 1024:
                        continue
                    try:
                        self._ensure_visible_relative(path)
                        mode = child.stat(follow_symlinks=False).st_mode
                    except RepositoryFileError, OSError:
                        continue
                    if stat.S_ISDIR(mode):
                        entries.append(DirectoryEntry(child.name, path, "directory"))
                    elif stat.S_ISREG(mode):
                        entries.append(DirectoryEntry(child.name, path, "file"))
        except OSError as error:
            raise self._descriptor_error(error) from error
        entries.sort(key=lambda entry: (entry.kind, entry.name.casefold(), entry.name))
        end = offset + BROWSER_PAGE_SIZE
        return DirectoryPage(
            entries=tuple(entries[offset:end]),
            next_offset=end if end < len(entries) else None,
            scan_limit_reached=scan_limit_reached,
        )

    def path_type(self, path: str) -> Literal["file", "directory"]:
        """Validate one visible path without walking its descendants."""
        candidate, relative = self._resolve_requested_path(path)
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError as error:
            raise RepositoryFileError(
                "file_not_found", "The requested file was not found."
            ) from error
        except OSError as error:
            raise RepositoryFileError(
                "unsafe_path", "The requested path cannot be inspected safely."
            ) from error
        self._ensure_contained(resolved)
        self._ensure_visible_relative(relative)
        self._ensure_visible_relative(resolved.relative_to(self._root).as_posix())
        try:
            mode = resolved.stat().st_mode
        except OSError as error:
            raise RepositoryFileError(
                "file_not_found", "The requested file was not found."
            ) from error
        if stat.S_ISDIR(mode):
            return "directory"
        if stat.S_ISREG(mode):
            return "file"
        raise RepositoryFileError("unsafe_path", "The requested path is not a regular file.")

    def read_file(
        self,
        path: str,
        start_line: int = 1,
        end_line: int | None = None,
        *,
        allow_unicode_bom: bool = False,
        max_lines: int = MAX_LINE_COUNT,
    ) -> FileRead:
        """Read from a root-anchored descriptor after canonical policy checks."""
        candidate, relative = self._resolve_requested_path(path)
        resolved, relative = self._resolve_file_candidate(candidate, relative)
        resolved_relative = resolved.relative_to(self._root)
        payload = self._read_descriptor_relative(resolved_relative)
        encoding = "utf-8"
        if allow_unicode_bom:
            if payload.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
                encoding = "utf-32"
            elif payload.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
                encoding = "utf-16"
            elif payload.startswith(codecs.BOM_UTF8):
                encoding = "utf-8-sig"
        try:
            text = payload.decode(encoding)
        except UnicodeDecodeError as error:
            raise RepositoryFileError("binary_file", "The requested file is binary.") from error
        if "\x00" in text:
            raise RepositoryFileError("binary_file", "The requested file is binary.")

        if _PRIVATE_KEY_HEADER.search(text):
            raise RepositoryFileError("unsafe_path", "The requested file is not available.")

        all_lines = text.splitlines()
        last_allowed = start_line + min(max_lines, MAX_PREVIEW_LINES) - 1
        requested_end = end_line if end_line is not None else last_allowed
        selected_end = min(requested_end, last_allowed, len(all_lines))
        if start_line > len(all_lines):
            selected_end = start_line - 1
        lines = tuple(
            NumberedLine(number=index, text=all_lines[index - 1])
            for index in range(start_line, selected_end + 1)
        )
        return FileRead(
            path=relative,
            start_line=start_line,
            end_line=selected_end,
            lines=lines,
            truncated=(
                len(all_lines) > selected_end if end_line is None else requested_end > selected_end
            ),
            content_sha256=hashlib.sha256(payload).hexdigest(),
        )

    def _open_directory(self, parts: tuple[str, ...], descriptors: ExitStack) -> int:
        """Walk directory descriptors below the registered root without following links."""
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        descriptor = os.open(self._root, flags)
        descriptors.callback(os.close, descriptor)
        root_stat = os.fstat(descriptor)
        if (root_stat.st_dev, root_stat.st_ino) != self._root_identity:
            raise RepositoryFileError(
                "repository_unavailable", "The registered repository changed."
            )
        for part in parts:
            descriptor = os.open(part, flags, dir_fd=descriptor)
            descriptors.callback(os.close, descriptor)
        return descriptor

    @staticmethod
    def _descriptor_error(error: OSError) -> RepositoryFileError:
        if isinstance(error, FileNotFoundError):
            return RepositoryFileError("file_not_found", "The requested path was not found.")
        return RepositoryFileError("unsafe_path", "The requested path cannot be inspected safely.")

    def _read_descriptor_relative(self, relative: Path) -> bytes:
        """Open a resolved regular file beneath the registered root descriptor."""
        try:
            with ExitStack() as descriptors:
                directory = self._open_directory(relative.parts[:-1], descriptors)
                file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                file_fd = os.open(relative.name, file_flags, dir_fd=directory)
                descriptors.callback(os.close, file_fd)
                opened = os.fstat(file_fd)
                if not stat.S_ISREG(opened.st_mode):
                    raise RepositoryFileError(
                        "unsafe_path", "The requested path is not a regular file."
                    )
                if opened.st_size > MAX_FILE_BYTES:
                    raise RepositoryFileError(
                        "file_too_large", "The requested file exceeds the 64 KiB read limit."
                    )
                payload = bytearray()
                while len(payload) <= MAX_FILE_BYTES:
                    chunk = os.read(file_fd, min(8192, MAX_FILE_BYTES + 1 - len(payload)))
                    if not chunk:
                        break
                    payload.extend(chunk)
                if len(payload) > MAX_FILE_BYTES:
                    raise RepositoryFileError(
                        "file_too_large", "The requested file exceeds the 64 KiB read limit."
                    )
                return bytes(payload)
        except OSError as error:
            raise self._descriptor_error(error) from error

    def _resolve_directory(self, directory: str) -> tuple[Path, str]:
        candidate, relative = self._resolve_requested_path(directory)
        try:
            resolved = candidate.resolve(strict=True)
        except OSError as error:
            raise RepositoryFileError(
                "file_not_found", "The requested path was not found."
            ) from error
        self._ensure_contained(resolved)
        self._ensure_visible_relative(relative)
        if not resolved.is_dir():
            raise RepositoryFileError("unsafe_path", "The requested path is not a directory.")
        return resolved, relative

    def _resolve_requested_path(self, request_path: str) -> tuple[Path, str]:
        normalized = normalize_repository_relative_path(request_path)
        relative = Path(normalized)
        self._ensure_visible_relative(normalized)
        return self._root / relative, normalized

    def _resolve_file_candidate(
        self, candidate: Path, requested_relative: str | None = None
    ) -> tuple[Path, str]:
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError as error:
            raise RepositoryFileError(
                "file_not_found", "The requested file was not found."
            ) from error
        except OSError as error:
            raise RepositoryFileError(
                "unsafe_path", "The requested path cannot be inspected safely."
            ) from error
        self._ensure_contained(resolved)
        relative = requested_relative or candidate.relative_to(self._root).as_posix()
        self._ensure_visible_relative(relative)
        self._ensure_visible_relative(resolved.relative_to(self._root).as_posix())
        try:
            mode = resolved.stat().st_mode
        except OSError as error:
            raise RepositoryFileError(
                "file_not_found", "The requested file was not found."
            ) from error
        if not stat.S_ISREG(mode):
            raise RepositoryFileError("unsafe_path", "The requested path is not a regular file.")
        return resolved, relative

    def _is_visible_directory(self, candidate: Path) -> bool:
        try:
            resolved = candidate.resolve(strict=True)
            self._ensure_contained(resolved)
            self._ensure_visible_relative(candidate.relative_to(self._root).as_posix())
            self._ensure_visible_relative(resolved.relative_to(self._root).as_posix())
        except OSError, RepositoryFileError:
            return False
        return resolved.is_dir()

    def _ensure_contained(self, resolved: Path) -> None:
        if not resolved.is_relative_to(self._root):
            raise RepositoryFileError(
                "unsafe_path", "The requested path is outside the repository."
            )

    @staticmethod
    def _ensure_visible_relative(relative: str) -> None:
        parts = tuple(part.lower() for part in PurePath(relative).parts)
        filename = parts[-1] if parts else ""
        if ".git" in parts:
            raise RepositoryFileError("unsafe_path", "The requested path is not available.")
        if any(part.startswith(".env") for part in parts) or filename in {
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
        }:
            raise RepositoryFileError("unsafe_path", "The requested path is not available.")
        if PurePath(filename).suffix in {".key", ".p12", ".pfx", ".ppk"}:
            raise RepositoryFileError("unsafe_path", "The requested path is not available.")
        if any(
            marker in component
            for component in parts
            for marker in ("credential", "secret", "token")
        ):
            raise RepositoryFileError("unsafe_path", "The requested path is not available.")
