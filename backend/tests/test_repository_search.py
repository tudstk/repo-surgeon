"""Executable contracts for bounded, exact repository search."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError
from support import MemoryRepositoryStore

from repo_surgeon.application.repository_search import (
    MAX_CONTEXT_LINES,
    MAX_MATCHES,
    MAX_SEARCH_RESULT_BYTES,
    MAX_SEARCH_TIMEOUT_MS,
    SearchError,
    SearchRequest,
)
from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.infrastructure.ripgrep_search import (
    CompletedSearchProcess,
    RipgrepSearchAdapter,
    SearchProcessTimeout,
)
from repo_surgeon.mcp.file_tools import ToolErrorOutput
from repo_surgeon.mcp.search_tools import SearchCodeInput, SearchCodeOutput


class RecordingRunner:
    def __init__(self, responses: list[CompletedSearchProcess | Exception]) -> None:
        self.responses = responses
        self.calls: list[tuple[tuple[str, ...], Path, float]] = []

    def run(
        self, argv: tuple[str, ...], cwd: Path, timeout_seconds: float
    ) -> CompletedSearchProcess:
        self.calls.append((argv, cwd, timeout_seconds))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def request(**updates: object) -> SearchRequest:
    values: dict[str, object] = {"query": "needle"}
    values.update(updates)
    return SearchRequest(**values)  # type: ignore[arg-type]


def test_search_request_clamps_each_independent_limit() -> None:
    result = request(
        max_matches=MAX_MATCHES + 1,
        context_before=MAX_CONTEXT_LINES + 1,
        context_after=MAX_CONTEXT_LINES + 1,
        timeout_ms=MAX_SEARCH_TIMEOUT_MS + 1,
        max_result_bytes=MAX_SEARCH_RESULT_BYTES + 1,
    )

    assert result.max_matches == MAX_MATCHES
    assert result.context_before == MAX_CONTEXT_LINES
    assert result.context_after == MAX_CONTEXT_LINES
    assert result.timeout_ms == MAX_SEARCH_TIMEOUT_MS
    assert result.max_result_bytes == MAX_SEARCH_RESULT_BYTES


@pytest.mark.parametrize("query", ["", "x\x00y", "x" * 4097])
def test_search_request_rejects_invalid_queries(query: str) -> None:
    with pytest.raises(ValueError):
        request(query=query)


@pytest.mark.parametrize("path", ["/tmp", "../outside", "src/../../outside", ".git"])
def test_search_rejects_unsafe_paths(tmp_path: Path, path: str) -> None:
    with pytest.raises(SearchError) as raised:
        RipgrepSearchAdapter().search(tmp_path, request(path=path))

    assert raised.value.code == "unsafe_path"


@pytest.mark.parametrize("glob", ["/tmp/*.py", "../*.py", "src/../../*.py", "", "x\x00y"])
def test_search_rejects_unsafe_globs(tmp_path: Path, glob: str) -> None:
    with pytest.raises(SearchError) as raised:
        RipgrepSearchAdapter().search(tmp_path, request(glob=glob))

    assert raised.value.code == "unsafe_glob"


def test_literal_and_regex_modes_are_distinct_and_preserve_citations(tmp_path: Path) -> None:
    source = tmp_path / "src" / "sample.py"
    source.parent.mkdir()
    source.write_text("before\na.*z\nabz\na.*z\nafter\n")
    adapter = RipgrepSearchAdapter()

    literal = adapter.search(
        tmp_path,
        request(query="a.*z", mode="literal", context_before=1, context_after=1),
    )
    regex = adapter.search(tmp_path, request(query="a.*z", mode="regex"))

    assert [(match.path, match.line, match.column) for match in literal.matches] == [
        ("src/sample.py", 2, 1),
        ("src/sample.py", 4, 1),
    ]
    assert literal.matches[0].before[0].number == 1
    assert literal.matches[0].after[0].number == 3
    assert [match.line for match in regex.matches] == [2, 3, 4]


def test_query_and_glob_are_fixed_arguments_not_shell_syntax(tmp_path: Path) -> None:
    (tmp_path / "safe.py").write_text("--hidden $(touch PWNED)\n")
    runner = RecordingRunner(
        [
            CompletedSearchProcess(0, b"safe.py\0", b""),
            CompletedSearchProcess(1, b"", b""),
        ]
    )
    adapter = RipgrepSearchAdapter(runner=runner)

    adapter.search(
        tmp_path,
        request(query="--hidden $(touch PWNED)", glob="*.py", mode="literal"),
    )

    file_argv, _, _ = runner.calls[0]
    search_argv, _, _ = runner.calls[1]
    assert "--glob=*.py" in file_argv
    assert "--fixed-strings" in search_argv
    assert search_argv[search_argv.index("--") + 1] == "--hidden $(touch PWNED)"
    assert not (tmp_path / "PWNED").exists()


def test_invalid_regex_returns_stable_error_without_stderr(tmp_path: Path) -> None:
    (tmp_path / "safe.py").write_text("content\n")

    with pytest.raises(SearchError) as raised:
        RipgrepSearchAdapter().search(tmp_path, request(query="[", mode="regex"))

    assert raised.value.code == "invalid_regex"
    assert str(tmp_path) not in raised.value.detail


def test_ignored_binary_invalid_utf8_and_secret_files_are_not_returned(tmp_path: Path) -> None:
    (tmp_path / ".gitignore").write_text("ignored/\n")
    (tmp_path / "safe.txt").write_text("needle\n")
    (tmp_path / "id_rsa").write_text("needle secret\n")
    (tmp_path / "credentials.json").write_text("needle secret\n")
    (tmp_path / "binary.dat").write_bytes(b"needle\x00binary")
    (tmp_path / "invalid.txt").write_bytes(b"needle\xff")
    (tmp_path / "ignored").mkdir()
    (tmp_path / "ignored" / "generated.txt").write_text("needle ignored\n")

    result = RipgrepSearchAdapter().search(tmp_path, request())

    assert [match.path for match in result.matches] == ["safe.txt"]
    assert result.skipped_files == 2


def test_match_context_and_byte_truncation_are_independent(tmp_path: Path) -> None:
    (tmp_path / "many.txt").write_text("\n".join(["context", "needle"] * 20))
    adapter = RipgrepSearchAdapter()

    matches = adapter.search(tmp_path, request(max_matches=2))
    context = adapter.search(
        tmp_path,
        request(context_before=10, context_after=10, max_result_bytes=700),
    )
    tiny = adapter.search(tmp_path, request(max_result_bytes=256))

    assert matches.match_count == 2
    assert matches.truncated
    assert "matches" in matches.truncation_reasons
    assert context.truncated
    assert set(context.truncation_reasons) & {"context", "bytes"}
    assert tiny.truncated
    assert "bytes" in tiny.truncation_reasons


def test_timeout_is_stable_and_shared_across_processes(tmp_path: Path) -> None:
    runner = RecordingRunner([SearchProcessTimeout()])

    with pytest.raises(SearchError) as raised:
        RipgrepSearchAdapter(runner=runner).search(tmp_path, request(timeout_ms=100))

    assert raised.value.code == "search_timed_out"
    assert runner.calls[0][2] <= 0.1


def test_no_matches_is_a_success(tmp_path: Path) -> None:
    (tmp_path / "safe.py").write_text("haystack\n")

    result = RipgrepSearchAdapter().search(tmp_path, request())

    assert result.matches == ()
    assert result.match_count == 0
    assert not result.truncated


def test_search_code_input_is_strict_and_forbids_unknown_arguments() -> None:
    repository_id = uuid4()
    with pytest.raises(ValidationError):
        SearchCodeInput.model_validate(
            {"repository_id": repository_id, "query": "needle", "max_matches": "2"}
        )
    with pytest.raises(ValidationError):
        SearchCodeInput.model_validate(
            {"repository_id": repository_id, "query": "needle", "command": "rg needle"}
        )


@pytest.mark.anyio
async def test_mcp_search_code_is_typed_bounded_and_repository_scoped(tmp_path: Path) -> None:
    from repo_surgeon.mcp.search_tools import McpSearchTools

    repository_id = uuid4()
    (tmp_path / "safe.py").write_text("needle one\nneedle two\n")
    repository = Repository(repository_id, RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))
    tools = McpSearchTools(MemoryRepositoryStore(repository))

    result = await tools.search_code(
        SearchCodeInput(repository_id=repository_id, query="needle", context_before=0),
        max_bytes=700,
    )
    missing = await tools.search_code(
        SearchCodeInput(repository_id=uuid4(), query="needle"), max_bytes=700
    )

    assert isinstance(result, SearchCodeOutput)
    assert result.match_count == 2
    assert len(json.dumps(result.model_dump(mode="json"), separators=(",", ":")).encode()) <= 700
    assert isinstance(missing, ToolErrorOutput)
    assert missing.code == "repository_not_found"
