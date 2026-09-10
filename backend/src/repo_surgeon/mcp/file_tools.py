"""Typed, in-process MCP-facing adapters for confined repository file tools."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
                FileEntryOutput(path=item.path, entry_type=item.entry_type, size_bytes=item.size_bytes)
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
            lines=tuple(NumberedLineOutput(number=item.number, text=item.text) for item in read.lines),
            truncated=read.truncated,
            content_sha256=read.content_sha256,
        )


class ToolErrorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    code: str
    detail: str


class McpFileTools:
    """Thin in-process adapter ready for registration with FastMCP.

    FastMCP is pinned in project metadata, but no transport is started in this
    Milestone 1 slice. This facade remains directly contract-testable while the
    environment cannot refresh its lockfile from PyPI.
    """

    def __init__(self, store: RepositoryStore) -> None:
        self._store = store

    async def list_files(self, arguments: ListFilesInput) -> ListFilesOutput | ToolErrorOutput:
        repository = await self._store.get(arguments.repository_id)
        if repository is None:
            return ToolErrorOutput(code="repository_not_found", detail="The requested repository was not found.")
        try:
            result = ConfinedRepositoryFiles(repository.canonical_root).list_files(
                arguments.directory, arguments.glob, arguments.max_results
            )
        except RepositoryFileError as error:
            return ToolErrorOutput(code=error.code, detail=error.detail)
        return ListFilesOutput.from_listing(result)

    async def read_file(self, arguments: ReadFileInput) -> ReadFileOutput | ToolErrorOutput:
        repository = await self._store.get(arguments.repository_id)
        if repository is None:
            return ToolErrorOutput(code="repository_not_found", detail="The requested repository was not found.")
        try:
            result = ConfinedRepositoryFiles(repository.canonical_root).read_file(
                arguments.path, arguments.start_line, arguments.end_line
            )
        except RepositoryFileError as error:
            return ToolErrorOutput(code=error.code, detail=error.detail)
        return ReadFileOutput.from_read(result)


def tool_audit_summary(result: ListFilesOutput | ReadFileOutput | ToolErrorOutput) -> dict[str, Any]:
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

    @server.tool(name="list_files", description="List bounded safe files in a registered repository.")
    async def list_files(
        repository_id: UUID,
        directory: str = ".",
        glob: str | None = None,
        max_results: int = 50,
    ) -> ListFilesOutput | ToolErrorOutput:
        return await tools.list_files(
            ListFilesInput(
                repository_id=repository_id,
                directory=directory,
                glob=glob,
                max_results=max_results,
            )
        )

    @server.tool(name="read_file", description="Read bounded numbered UTF-8 lines from a safe file.")
    async def read_file(
        repository_id: UUID,
        path: str,
        start_line: int = 1,
        end_line: int | None = None,
    ) -> ReadFileOutput | ToolErrorOutput:
        return await tools.read_file(
            ReadFileInput(
                repository_id=repository_id,
                path=path,
                start_line=start_line,
                end_line=end_line,
            )
        )

    return server
