"""Typed, in-process MCP-facing adapters for confined repository file tools."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from threading import BoundedSemaphore
from typing import Any, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from repo_surgeon.application.repositories import RepositoryStore
from repo_surgeon.application.repository_files import (
    MAX_FILE_COUNT,
    MAX_LINE_COUNT,
    ConfinedRepositoryFiles,
    FileListing,
    FileRead,
    RepositoryFileError,
)


class ListFilesInput(BaseModel):
    """Strict input contract for the read-only ``list_files`` MCP tool."""

    model_config = ConfigDict(extra="forbid", strict=True)
    repository_id: UUID
    directory: str = Field(default=".", min_length=1, max_length=4096)
    glob: str | None = Field(default=None, min_length=1, max_length=256)
    max_results: int = Field(default=50, ge=1)

    @field_validator("directory", "glob")
    @classmethod
    def reject_nul_paths(cls, value: str | None) -> str | None:
        if value is not None and "\0" in value:
            raise ValueError("path values must not contain NUL characters")
        return value

    @model_validator(mode="after")
    def clamp_max_results(self) -> ListFilesInput:
        self.max_results = min(self.max_results, MAX_FILE_COUNT)
        return self


class ReadFileInput(BaseModel):
    """Strict input contract for the bounded ``read_file`` MCP tool."""

    model_config = ConfigDict(extra="forbid", strict=True)
    repository_id: UUID
    path: str = Field(min_length=1, max_length=4096)
    start_line: int = Field(default=1, ge=1)
    end_line: int | None = Field(default=None, ge=1)

    @field_validator("path")
    @classmethod
    def reject_nul_path(cls, value: str) -> str:
        if "\0" in value:
            raise ValueError("path values must not contain NUL characters")
        return value

    @model_validator(mode="after")
    def clamp_line_range(self) -> ReadFileInput:
        if self.end_line is not None and self.end_line < self.start_line:
            raise ValueError("end_line must be greater than or equal to start_line")
        if self.end_line is not None:
            self.end_line = min(self.end_line, self.start_line + MAX_LINE_COUNT - 1)
        return self


class FileEntryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str
    entry_type: str
    size_bytes: int


class ListFilesOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    directory: str
    entries: tuple[FileEntryOutput, ...]
    truncated: bool

    @classmethod
    def from_listing(cls, listing: FileListing) -> ListFilesOutput:
        return cls(
            directory=listing.directory,
            entries=tuple(
                FileEntryOutput(
                    path=item.path, entry_type=item.entry_type, size_bytes=item.size_bytes
                )
                for item in listing.entries
            ),
            truncated=listing.truncated,
        )


class NumberedLineOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    number: int
    text: str


class ReadFileOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str
    start_line: int
    end_line: int
    lines: tuple[NumberedLineOutput, ...]
    truncated: bool
    content_sha256: str

    @classmethod
    def from_read(cls, read: FileRead) -> ReadFileOutput:
        return cls(
            path=read.path,
            start_line=read.start_line,
            end_line=read.end_line,
            lines=tuple(
                NumberedLineOutput(number=item.number, text=item.text) for item in read.lines
            ),
            truncated=read.truncated,
            content_sha256=read.content_sha256,
        )


class ToolErrorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    code: str
    detail: str


def _serialized_size(value: BaseModel) -> int:
    return len(
        json.dumps(value.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    )


def returned_bytes_limit_error() -> ToolErrorOutput:
    """Return the smallest provider-facing result supported by the tool contract."""
    return ToolErrorOutput(
        code="returned_bytes_limit", detail="The tool result exceeds the budget."
    )


MIN_TOOL_RESULT_BYTES = _serialized_size(returned_bytes_limit_error())


def _bound_error(result: ToolErrorOutput, max_bytes: int | None) -> ToolErrorOutput | None:
    if max_bytes is None or _serialized_size(result) <= max_bytes:
        return result
    error = returned_bytes_limit_error()
    return error if _serialized_size(error) <= max_bytes else None


def _bound_list_result(
    result: ListFilesOutput, max_bytes: int | None
) -> ListFilesOutput | ToolErrorOutput | None:
    if max_bytes is None or _serialized_size(result) <= max_bytes:
        return result
    for count in range(len(result.entries) - 1, -1, -1):
        candidate = result.model_copy(update={"entries": result.entries[:count], "truncated": True})
        if _serialized_size(candidate) <= max_bytes:
            return candidate
    error = returned_bytes_limit_error()
    return error if _serialized_size(error) <= max_bytes else None


def _bound_read_result(
    result: ReadFileOutput, max_bytes: int | None
) -> ReadFileOutput | ToolErrorOutput | None:
    if max_bytes is None or _serialized_size(result) <= max_bytes:
        return result
    for count in range(len(result.lines) - 1, -1, -1):
        last_line = result.lines[count - 1].number if count else result.start_line - 1
        candidate = result.model_copy(
            update={"lines": result.lines[:count], "end_line": last_line, "truncated": True}
        )
        if _serialized_size(candidate) <= max_bytes:
            return candidate
    error = returned_bytes_limit_error()
    return error if _serialized_size(error) <= max_bytes else None


_FILE_WORKER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="repo-surgeon-files")
_FILE_WORKER_SLOT = BoundedSemaphore(value=1)


def _list_repository_files(
    canonical_root: str,
    directory: str,
    glob: str | None,
    max_results: int,
) -> FileListing:
    return ConfinedRepositoryFiles(canonical_root).list_files(directory, glob, max_results)


def _read_repository_file(
    canonical_root: str,
    path: str,
    start_line: int,
    end_line: int | None,
) -> FileRead:
    return ConfinedRepositoryFiles(canonical_root).read_file(path, start_line, end_line)


async def _run_blocking[BlockingResult](
    function: Callable[..., BlockingResult], *args: object
) -> BlockingResult:
    while not _FILE_WORKER_SLOT.acquire(blocking=False):
        await asyncio.sleep(0.001)

    try:
        worker = _FILE_WORKER.submit(function, *args)
    except BaseException:
        _FILE_WORKER_SLOT.release()
        raise

    def release_worker_slot(_: Future[BlockingResult]) -> None:
        _FILE_WORKER_SLOT.release()

    worker.add_done_callback(release_worker_slot)
    return await asyncio.shield(asyncio.wrap_future(worker))


class McpFileTools:
    """Thin in-process adapter ready for registration with FastMCP.

    FastMCP is pinned in project metadata, but no transport is started in this
    Milestone 1 slice. This facade remains directly contract-testable while the
    environment cannot refresh its lockfile from PyPI.
    """

    def __init__(self, store: RepositoryStore) -> None:
        self._store = store

    async def list_files(
        self, arguments: ListFilesInput, max_bytes: int | None = None
    ) -> ListFilesOutput | ToolErrorOutput | None:
        if max_bytes is not None and max_bytes < MIN_TOOL_RESULT_BYTES:
            return None
        repository = await self._store.get(arguments.repository_id)
        if repository is None:
            return _bound_error(
                ToolErrorOutput(
                    code="repository_not_found",
                    detail="The requested repository was not found.",
                ),
                max_bytes,
            )
        try:
            listing = cast(
                FileListing,
                await _run_blocking(
                    _list_repository_files,
                    repository.canonical_root,
                    arguments.directory,
                    arguments.glob,
                    arguments.max_results,
                ),
            )
        except RepositoryFileError as error:
            return _bound_error(ToolErrorOutput(code=error.code, detail=error.detail), max_bytes)
        result = ListFilesOutput.from_listing(listing)
        return _bound_list_result(result, max_bytes)

    async def read_file(
        self, arguments: ReadFileInput, max_bytes: int | None = None
    ) -> ReadFileOutput | ToolErrorOutput | None:
        if max_bytes is not None and max_bytes < MIN_TOOL_RESULT_BYTES:
            return None
        repository = await self._store.get(arguments.repository_id)
        if repository is None:
            return _bound_error(
                ToolErrorOutput(
                    code="repository_not_found",
                    detail="The requested repository was not found.",
                ),
                max_bytes,
            )
        try:
            read = cast(
                FileRead,
                await _run_blocking(
                    _read_repository_file,
                    repository.canonical_root,
                    arguments.path,
                    arguments.start_line,
                    arguments.end_line,
                ),
            )
        except RepositoryFileError as error:
            return _bound_error(ToolErrorOutput(code=error.code, detail=error.detail), max_bytes)
        result = ReadFileOutput.from_read(read)
        return _bound_read_result(result, max_bytes)


def tool_audit_summary(
    result: ListFilesOutput | ReadFileOutput | ToolErrorOutput,
) -> dict[str, Any]:
    """Return a sanitized result summary with no file content or host paths."""
    if isinstance(result, ToolErrorOutput):
        return {"success": False, "code": result.code}
    if isinstance(result, ListFilesOutput):
        return {"success": True, "operation": "list_files", "result_count": len(result.entries)}
    return {
        "success": True,
        "operation": "read_file",
        "line_count": len(result.lines),
        "truncated": result.truncated,
        "content_sha256": result.content_sha256,
    }


def create_mcp_server(store: RepositoryStore) -> Any:
    """Build the in-process FastMCP server without starting any transport.

    The handlers are intentionally thin: FastMCP performs protocol framing while
    this module's strict Pydantic schemas and application service own validation
    and confinement.
    """
    from fastmcp import FastMCP

    tools = McpFileTools(store)
    server = FastMCP("Repo Surgeon")

    @server.tool(
        name="list_files", description="List bounded safe files in a registered repository."
    )
    async def list_files(
        repository_id: UUID,
        directory: str = ".",
        glob: str | None = None,
        max_results: int = 50,
    ) -> dict[str, object]:
        result = await tools.list_files(
            ListFilesInput(
                repository_id=repository_id,
                directory=directory,
                glob=glob,
                max_results=max_results,
            )
        )
        assert result is not None
        return cast(dict[str, object], result.model_dump(mode="json"))

    @server.tool(
        name="read_file", description="Read bounded numbered UTF-8 lines from a safe file."
    )
    async def read_file(
        repository_id: UUID,
        path: str,
        start_line: int = 1,
        end_line: int | None = None,
    ) -> dict[str, object]:
        result = await tools.read_file(
            ReadFileInput(
                repository_id=repository_id,
                path=path,
                start_line=start_line,
                end_line=end_line,
            )
        )
        assert result is not None
        return cast(dict[str, object], result.model_dump(mode="json"))

    return server
