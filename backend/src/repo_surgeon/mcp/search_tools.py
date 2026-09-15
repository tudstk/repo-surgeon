"""Typed MCP-facing contract for bounded repository search."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import suppress
from dataclasses import replace
from threading import BoundedSemaphore
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from repo_surgeon.application.repositories import RepositoryStore
from repo_surgeon.application.repository_search import (
    DEFAULT_CONTEXT_LINES,
    DEFAULT_MAX_MATCHES,
    DEFAULT_SEARCH_RESULT_BYTES,
    DEFAULT_SEARCH_TIMEOUT_MS,
    MAX_CONTEXT_LINES,
    MAX_MATCHES,
    MAX_SEARCH_RESULT_BYTES,
    MAX_SEARCH_TIMEOUT_MS,
    MIN_SEARCH_TIMEOUT_MS,
    SearchError,
    SearchMatch,
    SearchRequest,
    SearchResult,
)
from repo_surgeon.infrastructure.ripgrep_search import RipgrepSearchAdapter
from repo_surgeon.mcp.file_tools import (
    MIN_TOOL_RESULT_BYTES,
    NumberedLineOutput,
    ToolErrorOutput,
    returned_bytes_limit_error,
)


class SearchCodeArguments(BaseModel):
    """Strict search arguments with independently clamped effective limits."""

    model_config = ConfigDict(extra="forbid", strict=True)
    query: str = Field(min_length=1, max_length=4096)
    mode: Literal["literal", "regex"] = "literal"
    path: str = Field(default=".", min_length=1, max_length=4096)
    glob: str | None = Field(default=None, min_length=1, max_length=256)
    max_matches: int = Field(default=DEFAULT_MAX_MATCHES, ge=1)
    context_before: int = Field(default=DEFAULT_CONTEXT_LINES, ge=0)
    context_after: int = Field(default=DEFAULT_CONTEXT_LINES, ge=0)
    timeout_ms: int = Field(default=DEFAULT_SEARCH_TIMEOUT_MS, ge=1)
    max_result_bytes: int | None = Field(default=None, ge=1)

    @field_validator("query", "path", "glob")
    @classmethod
    def reject_nul(cls, value: str | None) -> str | None:
        if value is not None and "\0" in value:
            raise ValueError("text values must not contain NUL characters")
        return value

    @model_validator(mode="after")
    def clamp_limits(self) -> SearchCodeInput:
        self.max_matches = min(self.max_matches, MAX_MATCHES)
        self.context_before = min(self.context_before, MAX_CONTEXT_LINES)
        self.context_after = min(self.context_after, MAX_CONTEXT_LINES)
        self.timeout_ms = min(self.timeout_ms, MAX_SEARCH_TIMEOUT_MS)
        if self.max_result_bytes is not None:
            self.max_result_bytes = min(self.max_result_bytes, MAX_SEARCH_RESULT_BYTES)
        return self

    def to_request(self, outer_max_bytes: int | None) -> SearchRequest:
        result_budget = self.max_result_bytes or DEFAULT_SEARCH_RESULT_BYTES
        if outer_max_bytes is not None:
            result_budget = min(result_budget, outer_max_bytes)
        return SearchRequest(
            query=self.query,
            mode=self.mode,
            path=self.path,
            glob=self.glob,
            max_matches=self.max_matches,
            context_before=self.context_before,
            context_after=self.context_after,
            timeout_ms=self.timeout_ms,
            max_result_bytes=result_budget,
        )


class SearchCodeInput(SearchCodeArguments):
    """Strict provider input for a repository-scoped search."""

    repository_id: UUID


class SearchMatchOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str
    line: int
    column: int | None
    text: str
    before: tuple[NumberedLineOutput, ...]
    after: tuple[NumberedLineOutput, ...]

    @classmethod
    def from_match(cls, match: SearchMatch) -> SearchMatchOutput:
        return cls(
            path=match.path,
            line=match.line,
            column=match.column,
            text=match.text,
            before=tuple(
                NumberedLineOutput(number=line.number, text=line.text) for line in match.before
            ),
            after=tuple(
                NumberedLineOutput(number=line.number, text=line.text) for line in match.after
            ),
        )


class SearchCodeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    query: str
    mode: Literal["literal", "regex"]
    matches: tuple[SearchMatchOutput, ...]
    match_count: int
    truncated: bool
    truncation_reasons: tuple[Literal["matches", "context", "bytes"], ...]
    duration_ms: int
    skipped_files: int

    @classmethod
    def from_result(cls, result: SearchResult) -> SearchCodeOutput:
        return cls(
            query=result.query,
            mode=result.mode,
            matches=tuple(SearchMatchOutput.from_match(match) for match in result.matches),
            match_count=result.match_count,
            truncated=result.truncated,
            truncation_reasons=result.truncation_reasons,
            duration_ms=result.duration_ms,
            skipped_files=result.skipped_files,
        )


def _serialized_size(value: BaseModel) -> int:
    return len(
        json.dumps(value.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    )


def _bound_search_output(
    result: SearchCodeOutput, max_bytes: int | None
) -> SearchCodeOutput | ToolErrorOutput | None:
    if max_bytes is None or _serialized_size(result) <= max_bytes:
        return result
    has_context = any(match.before or match.after for match in result.matches)
    without_context = (
        result.model_copy(
            update={
                "matches": tuple(
                    match.model_copy(update={"before": (), "after": ()}) for match in result.matches
                ),
                "truncated": True,
                "truncation_reasons": tuple(dict.fromkeys((*result.truncation_reasons, "context"))),
            }
        )
        if has_context
        else result
    )
    if _serialized_size(without_context) <= max_bytes:
        return without_context
    for count in range(len(without_context.matches) - 1, -1, -1):
        candidate = without_context.model_copy(
            update={
                "matches": without_context.matches[:count],
                "match_count": count,
                "truncated": True,
                "truncation_reasons": tuple(
                    dict.fromkeys((*without_context.truncation_reasons, "bytes"))
                ),
            }
        )
        if _serialized_size(candidate) <= max_bytes:
            return candidate
    error = returned_bytes_limit_error()
    return error if max_bytes is None or _serialized_size(error) <= max_bytes else None


_SEARCH_WORKER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="repo-surgeon-search")
_SEARCH_WORKER_SLOT = BoundedSemaphore(value=1)


class SearchAdapter(Protocol):
    def search(self, canonical_root: str, request: SearchRequest) -> SearchResult: ...

    def cancel(self) -> None: ...


async def _run_search(
    canonical_root: str,
    request: SearchRequest,
    adapter_factory: Callable[[], SearchAdapter],
) -> SearchResult:
    deadline = asyncio.get_running_loop().time() + request.timeout_ms / 1_000
    while not _SEARCH_WORKER_SLOT.acquire(blocking=False):
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise SearchError("search_timed_out", "Repository search timed out.")
        await asyncio.sleep(min(0.001, remaining))
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining < MIN_SEARCH_TIMEOUT_MS / 1_000:
        _SEARCH_WORKER_SLOT.release()
        raise SearchError("search_timed_out", "Repository search timed out.")
    effective_request = replace(request, timeout_ms=max(1, int(remaining * 1_000)))
    adapter = adapter_factory()
    try:
        worker = _SEARCH_WORKER.submit(adapter.search, canonical_root, effective_request)
    except BaseException:
        _SEARCH_WORKER_SLOT.release()
        raise

    def release_worker_slot(_: Future[SearchResult]) -> None:
        _SEARCH_WORKER_SLOT.release()

    worker.add_done_callback(release_worker_slot)
    wrapped = asyncio.wrap_future(worker)
    try:
        return await asyncio.shield(wrapped)
    except asyncio.CancelledError:
        adapter.cancel()
        while not worker.done():
            await asyncio.sleep(0.001)
        with suppress(BaseException):
            worker.exception()
        with suppress(BaseException):
            wrapped.exception()
        raise


class McpSearchTools:
    """Resolve repository capabilities before dispatching fixed search arguments."""

    def __init__(
        self,
        store: RepositoryStore,
        adapter_factory: Callable[[], SearchAdapter] = RipgrepSearchAdapter,
    ) -> None:
        self._store = store
        self._adapter_factory = adapter_factory

    async def search_code(
        self, arguments: SearchCodeInput, max_bytes: int | None = None
    ) -> SearchCodeOutput | ToolErrorOutput | None:
        if max_bytes is not None and max_bytes < MIN_TOOL_RESULT_BYTES:
            return None
        repository = await self._store.get(arguments.repository_id)
        if repository is None:
            error = ToolErrorOutput(
                code="repository_not_found", detail="The requested repository was not found."
            )
            if max_bytes is None or _serialized_size(error) <= max_bytes:
                return error
            fallback = returned_bytes_limit_error()
            return fallback if _serialized_size(fallback) <= max_bytes else None
        try:
            request = arguments.to_request(max_bytes)
            result = await _run_search(repository.canonical_root, request, self._adapter_factory)
        except SearchError as error:
            output = ToolErrorOutput(code=error.code, detail=error.detail)
            if max_bytes is None or _serialized_size(output) <= max_bytes:
                return output
            fallback = returned_bytes_limit_error()
            return fallback if _serialized_size(fallback) <= max_bytes else None
        return _bound_search_output(SearchCodeOutput.from_result(result), max_bytes)
