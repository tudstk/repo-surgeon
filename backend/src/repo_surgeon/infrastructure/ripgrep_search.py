"""Fixed-argument ripgrep adapter for confined repository search."""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass, replace
from pathlib import Path, PurePath
from typing import Protocol, cast

from repo_surgeon.application.repository_files import (
    MAX_FILE_BYTES,
    ConfinedRepositoryFiles,
    NumberedLine,
    RepositoryFileError,
    normalize_repository_relative_path,
)
from repo_surgeon.application.repository_search import (
    MAX_SEARCH_FILES,
    SearchError,
    SearchMatch,
    SearchRequest,
    SearchResult,
    TruncationReason,
)

PROCESS_OUTPUT_LIMIT = 2 * 1024 * 1024


class SearchProcessTimeout(Exception):
    """The child process was killed and reaped after its deadline."""


class SearchProcessOutputLimit(Exception):
    """The child output exceeded the adapter's fixed capture limit."""


@dataclass(frozen=True, slots=True)
class CompletedSearchProcess:
    returncode: int
    stdout: bytes
    stderr: bytes


class SearchProcessRunner(Protocol):
    def run(
        self, argv: tuple[str, ...], cwd: Path, timeout_seconds: float
    ) -> CompletedSearchProcess: ...


class SubprocessSearchRunner:
    """Run one argv without a shell and bound time and captured bytes."""

    def run(
        self, argv: tuple[str, ...], cwd: Path, timeout_seconds: float
    ) -> CompletedSearchProcess:
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
        )
        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired as error:
            process.kill()
            process.communicate()
            raise SearchProcessTimeout from error
        if len(stdout) + len(stderr) > PROCESS_OUTPUT_LIMIT:
            raise SearchProcessOutputLimit
        return CompletedSearchProcess(process.returncode, stdout, stderr)


class RipgrepSearchAdapter:
    """Search only validated, visible UTF-8 files and return exact line citations."""

    def __init__(self, runner: SearchProcessRunner | None = None) -> None:
        self._runner = runner or SubprocessSearchRunner()

    def search(self, canonical_root: str | Path, request: SearchRequest) -> SearchResult:
        started = time.monotonic()
        root = Path(canonical_root)
        try:
            files = ConfinedRepositoryFiles(str(root))
            normalized_path = normalize_repository_relative_path(request.path)
            files.list_files(normalized_path, max_results=1)
        except RepositoryFileError as error:
            raise SearchError(error.code, error.detail) from error
        self._validate_glob(request.glob)
        deadline = started + request.timeout_ms / 1_000

        if request.mode == "regex":
            validation = self._run(
                ("rg", "--json", "--color=never", "--", request.query), root, deadline
            )
            if validation.returncode == 2:
                raise SearchError("invalid_regex", "The regular expression is invalid.")
            if validation.returncode not in (0, 1):
                raise SearchError("search_failed", "Repository search failed.")

        file_argv = [
            "rg",
            "--files",
            "-0",
            "--color=never",
            "--no-require-git",
            "--no-ignore-parent",
        ]
        if request.glob is not None:
            file_argv.append(f"--glob={request.glob}")
        file_argv.extend(("--", normalized_path))
        discovered = self._run(tuple(file_argv), root, deadline)
        if discovered.returncode not in (0, 1):
            raise SearchError("search_failed", "Repository search failed.")

        candidates = [
            normalize_repository_relative_path(item.decode("utf-8"))
            for item in discovered.stdout.split(b"\0")
            if item
        ]
        if len(candidates) > MAX_SEARCH_FILES:
            raise SearchError("search_output_limit", "Repository search exceeded its file limit.")

        searchable: list[str] = []
        skipped_files = 0
        for candidate in candidates:
            try:
                files.read_file(candidate)
            except RepositoryFileError as error:
                if error.code in {"binary_file", "file_too_large", "file_not_found"}:
                    skipped_files += 1
                continue
            searchable.append(candidate)

        if not searchable:
            return SearchResult(
                request.query,
                request.mode,
                (),
                0,
                False,
                duration_ms=self._duration_ms(started),
                skipped_files=skipped_files,
            )

        search_argv = [
            "rg",
            "--json",
            "--color=never",
            "--no-heading",
            "--line-number",
            "--column",
            "--max-count",
            str(request.max_matches + 1),
            "--max-filesize",
            str(MAX_FILE_BYTES),
        ]
        if request.mode == "literal":
            search_argv.append("--fixed-strings")
        search_argv.extend(("--", request.query, *searchable))
        completed = self._run(tuple(search_argv), root, deadline)
        if completed.returncode not in (0, 1):
            raise SearchError("search_failed", "Repository search failed.")

        parsed = self._parse_matches(completed.stdout)
        reasons: list[TruncationReason] = []
        if len(parsed) > request.max_matches:
            parsed = parsed[: request.max_matches]
            reasons.append("matches")
        matches = tuple(self._with_context(files, item, request) for item in parsed)
        result = SearchResult(
            query=request.query,
            mode=request.mode,
            matches=matches,
            match_count=len(matches),
            truncated=bool(reasons),
            truncation_reasons=tuple(reasons),
            duration_ms=self._duration_ms(started),
            skipped_files=skipped_files,
        )
        return self._bound_result(result, request.max_result_bytes)

    def _run(self, argv: tuple[str, ...], root: Path, deadline: float) -> CompletedSearchProcess:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SearchError("search_timed_out", "Repository search timed out.")
        try:
            return self._runner.run(argv, root, remaining)
        except SearchProcessTimeout as error:
            raise SearchError("search_timed_out", "Repository search timed out.") from error
        except SearchProcessOutputLimit as error:
            raise SearchError(
                "search_output_limit", "Repository search output was too large."
            ) from error
        except OSError as error:
            raise SearchError("search_failed", "Repository search is unavailable.") from error

    @staticmethod
    def _validate_glob(glob: str | None) -> None:
        if glob is None:
            return
        supplied = PurePath(glob)
        if not glob or "\0" in glob or supplied.is_absolute() or ".." in supplied.parts:
            raise SearchError("unsafe_glob", "The requested glob is not safe.")

    @staticmethod
    def _parse_matches(payload: bytes) -> list[SearchMatch]:
        matches: list[SearchMatch] = []
        for raw_line in payload.splitlines():
            try:
                event = json.loads(raw_line)
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise SearchError(
                    "search_failed", "Repository search returned invalid data."
                ) from error
            if event.get("type") != "match":
                continue
            data = event.get("data", {})
            path = data.get("path", {}).get("text")
            text = data.get("lines", {}).get("text")
            line = data.get("line_number")
            submatches = data.get("submatches", [])
            if not isinstance(path, str) or not isinstance(text, str) or not isinstance(line, int):
                raise SearchError("search_failed", "Repository search returned invalid data.")
            column = None
            if submatches and isinstance(submatches[0].get("start"), int):
                column = cast(int, submatches[0]["start"]) + 1
            matches.append(
                SearchMatch(path=path, line=line, column=column, text=text.rstrip("\r\n"))
            )
        return matches

    @staticmethod
    def _with_context(
        files: ConfinedRepositoryFiles, match: SearchMatch, request: SearchRequest
    ) -> SearchMatch:
        start = max(1, match.line - request.context_before)
        end = match.line + request.context_after
        try:
            read = files.read_file(match.path, start, end)
        except RepositoryFileError as error:
            raise SearchError(
                "search_failed", "A search result could not be verified safely."
            ) from error
        matched = next((line for line in read.lines if line.number == match.line), None)
        if matched is None or matched.text != match.text:
            raise SearchError("search_failed", "A search result changed before verification.")
        before = tuple(line for line in read.lines if line.number < match.line)
        after = tuple(line for line in read.lines if line.number > match.line)
        return replace(match, before=before, after=after)

    @classmethod
    def _bound_result(cls, result: SearchResult, max_bytes: int) -> SearchResult:
        if cls._serialized_size(result) <= max_bytes:
            return result
        without_context = replace(
            result,
            matches=tuple(replace(match, before=(), after=()) for match in result.matches),
            truncated=True,
            truncation_reasons=cls._add_reason(result.truncation_reasons, "context"),
        )
        if cls._serialized_size(without_context) <= max_bytes:
            return without_context
        matches = list(without_context.matches)
        while matches:
            matches.pop()
            candidate = replace(
                without_context,
                matches=tuple(matches),
                match_count=len(matches),
                truncation_reasons=cls._add_reason(without_context.truncation_reasons, "bytes"),
            )
            if cls._serialized_size(candidate) <= max_bytes:
                return candidate
        return replace(
            without_context,
            matches=(),
            match_count=0,
            truncation_reasons=cls._add_reason(without_context.truncation_reasons, "bytes"),
        )

    @staticmethod
    def _serialized_size(result: SearchResult) -> int:
        def numbered(line: NumberedLine) -> dict[str, object]:
            return {"number": line.number, "text": line.text}

        value = {
            "query": result.query,
            "mode": result.mode,
            "matches": [
                {
                    "path": item.path,
                    "line": item.line,
                    "column": item.column,
                    "text": item.text,
                    "before": [numbered(line) for line in item.before],
                    "after": [numbered(line) for line in item.after],
                }
                for item in result.matches
            ],
            "match_count": result.match_count,
            "truncated": result.truncated,
            "truncation_reasons": result.truncation_reasons,
            "duration_ms": result.duration_ms,
            "skipped_files": result.skipped_files,
        }
        return len(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())

    @staticmethod
    def _add_reason(
        reasons: tuple[TruncationReason, ...], reason: TruncationReason
    ) -> tuple[TruncationReason, ...]:
        return reasons if reason in reasons else (*reasons, reason)

    @staticmethod
    def _duration_ms(started: float) -> int:
        return max(0, int((time.monotonic() - started) * 1_000))
