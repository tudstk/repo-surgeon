"""Bounded, read-only inspection services for registered repositories."""

from __future__ import annotations

import fnmatch
import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Literal

MAX_FILE_COUNT = 200
MAX_FILE_BYTES = 64 * 1024
MAX_LINE_COUNT = 200


@dataclass(frozen=True, slots=True)
class RepositoryFileError(Exception):
    """A stable, content-free error suitable for an untrusted caller."""

    code: str
    detail: str


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

    def __init__(self, canonical_root: str) -> None:
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

    def list_files(
        self, directory: str = ".", glob: str | None = None, max_results: int = 50
    ) -> FileListing:
        """Return safe regular files below a confined directory using a fixed walk."""
        visible_directory, normalized_directory = self._resolve_directory(directory)
        limit = min(max_results, MAX_FILE_COUNT)
        entries: list[FileEntry] = []
        for current_root, directories, files in os.walk(visible_directory, followlinks=False):
            current = Path(current_root)
            directories[:] = sorted(
                child for child in directories if self._is_visible_directory(current / child)
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

    def read_file(self, path: str, start_line: int = 1, end_line: int | None = None) -> FileRead:
        """Read from a root-anchored descriptor after canonical policy checks."""
        candidate, relative = self._resolve_requested_path(path)
        resolved, relative = self._resolve_file_candidate(candidate, relative)
        resolved_relative = resolved.relative_to(self._root)
        payload = self._read_descriptor_relative(resolved_relative)
        if b"\x00" in payload:
            raise RepositoryFileError("binary_file", "The requested file is binary.")
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RepositoryFileError("binary_file", "The requested file is binary.") from error

        all_lines = text.splitlines()
        requested_end = end_line if end_line is not None else start_line + MAX_LINE_COUNT - 1
        selected_end = min(requested_end, start_line + MAX_LINE_COUNT - 1, len(all_lines))
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
            truncated=requested_end > selected_end,
            content_sha256=hashlib.sha256(payload).hexdigest(),
        )

    def _read_descriptor_relative(self, relative: Path) -> bytes:
        """Open a pre-resolved child below the root without following any link.

        The initial resolve detects a symlink escape.  This descriptor walk then
        closes the time-of-check/time-of-use window: each component is opened
        beneath the original root descriptor with ``O_NOFOLLOW``, and the final
        regular-file check happens after the descriptor is open.
        """
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        root_fd = os.open(self._root, directory_flags)
        descriptors = [root_fd]
        try:
            parts = relative.parts
            for component in parts[:-1]:
                descriptors.append(os.open(component, directory_flags, dir_fd=descriptors[-1]))
            file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            file_fd = os.open(parts[-1], file_flags, dir_fd=descriptors[-1])
            descriptors.append(file_fd)
            opened = os.fstat(file_fd)
            if not stat.S_ISREG(opened.st_mode):
                raise RepositoryFileError(
                    "unsafe_path", "The requested path is not a regular file."
                )
            if opened.st_size > MAX_FILE_BYTES:
                raise RepositoryFileError(
                    "file_too_large", "The requested file exceeds the read limit."
                )
            payload = b""
            while len(payload) <= MAX_FILE_BYTES:
                chunk = os.read(file_fd, min(8192, MAX_FILE_BYTES + 1 - len(payload)))
                if not chunk:
                    break
                payload += chunk
            if len(payload) > MAX_FILE_BYTES:
                raise RepositoryFileError(
                    "file_too_large", "The requested file exceeds the read limit."
                )
            return payload
        except RepositoryFileError:
            raise
        except FileNotFoundError as error:
            raise RepositoryFileError(
                "file_not_found", "The requested file was not found."
            ) from error
        except OSError as error:
            raise RepositoryFileError(
                "unsafe_path", "The requested path cannot be inspected safely."
            ) from error
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

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
        supplied = PurePath(request_path)
        if not request_path or supplied.is_absolute() or ".." in supplied.parts:
            raise RepositoryFileError(
                "unsafe_path", "The requested path is outside the repository."
            )
        relative = Path(*supplied.parts)
        normalized = relative.as_posix()
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
        if filename.startswith(".env") or filename in {
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
        }:
            raise RepositoryFileError("unsafe_path", "The requested path is not available.")
        if any(
            marker in component
            for component in parts
            for marker in ("credential", "secret", "token")
        ):
            raise RepositoryFileError("unsafe_path", "The requested path is not available.")
