"""Typed contracts for exact, bounded repository search."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from repo_surgeon.application.repository_files import NumberedLine

DEFAULT_MAX_MATCHES = 50
MAX_MATCHES = 200
DEFAULT_CONTEXT_LINES = 2
MAX_CONTEXT_LINES = 10
DEFAULT_SEARCH_TIMEOUT_MS = 1_000
MAX_SEARCH_TIMEOUT_MS = 5_000
MIN_SEARCH_TIMEOUT_MS = 100
DEFAULT_SEARCH_RESULT_BYTES = 64 * 1024
MAX_SEARCH_RESULT_BYTES = 128 * 1024
MIN_SEARCH_RESULT_BYTES = 256
MAX_SEARCH_QUERY_LENGTH = 4_096
MAX_SEARCH_GLOB_LENGTH = 256
MAX_SEARCH_FILES = 1_000

SearchMode = Literal["literal", "regex"]
TruncationReason = Literal["matches", "context", "bytes"]


@dataclass(frozen=True, slots=True)
class SearchError(Exception):
    """Stable content-free search failure safe for an untrusted caller."""

    code: str
    detail: str


@dataclass(frozen=True, slots=True)
class SearchRequest:
    """Validated effective arguments for one repository search."""

    query: str
    mode: SearchMode = "literal"
    path: str = "."
    glob: str | None = None
    max_matches: int = DEFAULT_MAX_MATCHES
    context_before: int = DEFAULT_CONTEXT_LINES
    context_after: int = DEFAULT_CONTEXT_LINES
    timeout_ms: int = DEFAULT_SEARCH_TIMEOUT_MS
    max_result_bytes: int = DEFAULT_SEARCH_RESULT_BYTES

    def __post_init__(self) -> None:
        if not self.query or len(self.query) > MAX_SEARCH_QUERY_LENGTH or "\0" in self.query:
            raise ValueError("query must be non-empty, bounded text without NUL")
        if self.mode not in ("literal", "regex"):
            raise ValueError("mode must be literal or regex")
        if self.max_matches < 1:
            raise ValueError("max_matches must be positive")
        if self.context_before < 0 or self.context_after < 0:
            raise ValueError("context values must be non-negative")
        if self.timeout_ms < 1:
            raise ValueError("timeout_ms must be positive")
        if self.max_result_bytes < 1:
            raise ValueError("max_result_bytes must be positive")
        object.__setattr__(self, "max_matches", min(self.max_matches, MAX_MATCHES))
        object.__setattr__(self, "context_before", min(self.context_before, MAX_CONTEXT_LINES))
        object.__setattr__(self, "context_after", min(self.context_after, MAX_CONTEXT_LINES))
        object.__setattr__(
            self,
            "timeout_ms",
            min(max(self.timeout_ms, MIN_SEARCH_TIMEOUT_MS), MAX_SEARCH_TIMEOUT_MS),
        )
        object.__setattr__(
            self,
            "max_result_bytes",
            min(max(self.max_result_bytes, MIN_SEARCH_RESULT_BYTES), MAX_SEARCH_RESULT_BYTES),
        )


@dataclass(frozen=True, slots=True)
class SearchMatch:
    path: str
    line: int
    column: int | None
    text: str
    before: tuple[NumberedLine, ...] = ()
    after: tuple[NumberedLine, ...] = ()


@dataclass(frozen=True, slots=True)
class SearchResult:
    query: str
    mode: SearchMode
    matches: tuple[SearchMatch, ...]
    match_count: int
    truncated: bool
    truncation_reasons: tuple[TruncationReason, ...] = field(default_factory=tuple)
    duration_ms: int = 0
    skipped_files: int = 0

    def audit_summary(self) -> dict[str, object]:
        return {
            "operation": "search_code",
            "mode": self.mode,
            "match_count": self.match_count,
            "truncated": self.truncated,
            "duration_ms": self.duration_ms,
            "skipped_files": self.skipped_files,
        }
