"""Fixed-argument ripgrep adapter for confined repository search."""

from __future__ import annotations

import json
import multiprocessing
import os
import selectors
import subprocess
import time
from contextlib import suppress
from dataclasses import dataclass, replace
from pathlib import Path, PurePath, PureWindowsPath
from threading import Event, Lock
from typing import Protocol, cast

from repo_surgeon.application.repository_files import (
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


def _policy_read_worker(
    root: str, candidate: str, connection: multiprocessing.connection.Connection
) -> None:
    try:
        ConfinedRepositoryFiles(root).read_file(candidate, 1, 1)
    except RepositoryFileError as error:
        connection.send(("error", error.code, error.detail))
    else:
        connection.send(("ok",))
    finally:
        connection.close()


class SearchProcessTimeout(Exception):
    """The child process was killed and reaped after its deadline."""


class SearchProcessOutputLimit(Exception):
    """The child output exceeded the adapter's fixed capture limit."""


class SearchProcessCancelled(Exception):
    """The search caller cancelled and the child was reaped."""


@dataclass(frozen=True, slots=True)
class CompletedSearchProcess:
    returncode: int
    stdout: bytes
    stderr: bytes


class SearchProcessRunner(Protocol):
    def run(
        self, argv: tuple[str, ...], cwd: Path, timeout_seconds: float
    ) -> CompletedSearchProcess: ...

    def cancel(self) -> None: ...

    def reset(self) -> None: ...


class SubprocessSearchRunner:
    """Run one argv without a shell and bound time and captured bytes."""

    def __init__(self) -> None:
        self._cancelled = Event()
        self._process_lock = Lock()
        self._process: subprocess.Popen[bytes] | None = None

    def run(
        self, argv: tuple[str, ...], cwd: Path, timeout_seconds: float
    ) -> CompletedSearchProcess:
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            shell=False,
        )
        with self._process_lock:
            self._process = process
            cancelled = self._cancelled.is_set()
        if cancelled:
            self._kill_and_reap(process)
            self._clear_process(process)
            raise SearchProcessCancelled
        assert process.stdout is not None
        captured = bytearray()
        deadline = time.monotonic() + timeout_seconds
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        try:
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._kill_and_reap(process)
                    raise SearchProcessTimeout
                ready = selector.select(remaining)
                if not ready:
                    self._kill_and_reap(process)
                    raise SearchProcessTimeout
                for key, _ in ready:
                    chunk = os.read(key.fd, min(8_192, PROCESS_OUTPUT_LIMIT + 1 - len(captured)))
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    captured.extend(chunk)
                    if len(captured) > PROCESS_OUTPUT_LIMIT:
                        self._kill_and_reap(process)
                        raise SearchProcessOutputLimit
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._kill_and_reap(process)
                raise SearchProcessTimeout
            returncode = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as error:
            self._kill_and_reap(process)
            raise SearchProcessTimeout from error
        finally:
            selector.close()
            process.stdout.close()
            self._clear_process(process)
        return CompletedSearchProcess(returncode, bytes(captured), b"")

    def cancel(self) -> None:
        """Stop and reap the active child from an asyncio cancellation path."""
        self._cancelled.set()
        with self._process_lock:
            process = self._process
        if process is not None:
            self._kill_and_reap(process)

    def reset(self) -> None:
        self._cancelled.clear()

    def _clear_process(self, process: subprocess.Popen[bytes]) -> None:
        with self._process_lock:
            if self._process is process:
                self._process = None

    @staticmethod
    def _kill_and_reap(process: subprocess.Popen[bytes]) -> None:
        if process.poll() is None:
            with suppress(ProcessLookupError):
                process.kill()
        process.wait()


class RipgrepSearchAdapter:
    """Search only validated, visible UTF-8 files and return exact line citations."""

    def __init__(self, runner: SearchProcessRunner | None = None) -> None:
        self._runner = runner or SubprocessSearchRunner()
        self._cancelled = Event()
        self._state_lock = Lock()
        self._policy_process: multiprocessing.Process | None = None

    def cancel(self) -> None:
        """Cancel an active search and synchronously reap its child process."""
        with self._state_lock:
            self._cancelled.set()
            self._runner.cancel()
            policy_process = self._policy_process
            if policy_process is not None and policy_process.is_alive():
                policy_process.terminate()

    def search(self, canonical_root: str | Path, request: SearchRequest) -> SearchResult:
        try:
            return self._search(canonical_root, request)
        finally:
            with self._state_lock:
                self._cancelled.clear()
                reset = getattr(self._runner, "reset", None)
                if reset is not None:
                    reset()

    def _search(self, canonical_root: str | Path, request: SearchRequest) -> SearchResult:
        started = time.monotonic()
        root = Path(canonical_root)
        deadline = started + request.timeout_ms / 1_000
        try:
            files = ConfinedRepositoryFiles(str(root))
            normalized_path = self._normalize_search_path(request.path)
            files.path_type(normalized_path)
        except RepositoryFileError as error:
            raise SearchError(error.code, error.detail) from error
        self._validate_glob(request.glob)
        self._raise_if_deadline_exceeded(deadline)

        if request.mode == "regex":
            validation = self._run(
                ("rg", "--json", "--color=never", "--", request.query, "/dev/null"),
                root,
                deadline,
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
            "--hidden",
        ]
        if request.glob is not None:
            file_argv.append(f"--glob={request.glob}")
        file_argv.extend(
            (
                "--glob=!**/.git/**",
                "--glob=!**/.env*",
                "--glob=!**/id_rsa",
                "--glob=!**/id_dsa",
                "--glob=!**/id_ecdsa",
                "--glob=!**/id_ed25519",
                "--glob=!**/*credential*",
                "--glob=!**/*secret*",
                "--glob=!**/*token*",
            )
        )
        file_argv.append("--glob-case-insensitive")
        file_argv.extend(("--", normalized_path))
        discovered = self._run(tuple(file_argv), root, deadline)
        if discovered.returncode not in (0, 1):
            raise SearchError("search_failed", "Repository search failed.")

        candidates: list[str] = []
        skipped_files = 0
        for item in discovered.stdout.split(b"\0"):
            if not item:
                continue
            try:
                candidate = self._normalize_search_path(item.decode("utf-8"))
                if candidate == ".git" or candidate.startswith(".git/"):
                    continue
                candidates.append(candidate)
            except UnicodeDecodeError, SearchError:
                skipped_files += 1
        searchable: list[str] = []
        for candidate in candidates:
            self._raise_if_cancelled()
            self._raise_if_deadline_exceeded(deadline)
            try:
                files.path_type(candidate)
                self._check_candidate_policy(root, candidate, deadline)
            except RepositoryFileError as error:
                if error.code in {"binary_file", "file_too_large", "file_not_found"}:
                    skipped_files += 1
                self._raise_if_deadline_exceeded(deadline)
                continue
            self._raise_if_deadline_exceeded(deadline)
            searchable.append(candidate)
            if len(searchable) > MAX_SEARCH_FILES:
                raise SearchError("search_output_limit", "Repository search exceeded its file limit.")

        if not searchable:
            result = SearchResult(
                request.query,
                request.mode,
                (),
                0,
                False,
                duration_ms=self._duration_ms(started),
                skipped_files=skipped_files,
            )
            self._raise_if_cancelled()
            return result

        search_argv = [
            "rg",
            "--json",
            "--color=never",
            "--no-heading",
            "--line-number",
            "--column",
            "--max-count",
            str(request.max_matches + 1),
        ]
        if request.mode == "literal":
            search_argv.append("--fixed-strings")
        parsed: list[SearchMatch] = []
        reasons: list[TruncationReason] = []
        for candidate in searchable:
            self._raise_if_cancelled()
            remaining = request.max_matches - len(parsed)
            candidate_search_argv = search_argv.copy()
            candidate_search_argv[candidate_search_argv.index("--max-count") + 1] = str(
                remaining + 1
            )
            candidate_search = tuple((*candidate_search_argv, "--", request.query, candidate))
            completed = self._run(candidate_search, root, deadline)
            if completed.returncode not in (0, 1):
                raise SearchError("search_failed", "Repository search failed.")
            candidate_matches = self._parse_matches(completed.stdout)
            if len(candidate_matches) == remaining + 1:
                reasons.append("matches")
            parsed.extend(candidate_matches)
            if len(parsed) > request.max_matches:
                reasons.append("matches")
                parsed = parsed[: request.max_matches]
                break
        verified_matches: list[SearchMatch] = []
        for item in parsed:
            self._raise_if_deadline_exceeded(deadline)
            verified = self._with_context(files, item, request, deadline)
            if verified is None:
                skipped_files += 1
            else:
                verified_matches.append(verified)
        matches = tuple(verified_matches)
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
        bounded = self._bound_result(result, request.max_result_bytes)
        self._raise_if_cancelled()
        return bounded

    def _run(self, argv: tuple[str, ...], root: Path, deadline: float) -> CompletedSearchProcess:
        self._raise_if_cancelled()
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
        except SearchProcessCancelled as error:
            raise SearchError("search_cancelled", "Repository search was cancelled.") from error
        except OSError as error:
            raise SearchError("search_failed", "Repository search is unavailable.") from error

    def _raise_if_cancelled(self) -> None:
        if self._cancelled.is_set():
            raise SearchError("search_cancelled", "Repository search was cancelled.")

    @staticmethod
    def _raise_if_deadline_exceeded(deadline: float) -> None:
        if time.monotonic() >= deadline:
            raise SearchError("search_timed_out", "Repository search timed out.")

    def _check_candidate_policy(
        self,
        root: Path, candidate: str, deadline: float
    ) -> None:
        self._raise_if_cancelled()
        parent, child = multiprocessing.Pipe(duplex=False)
        policy_worker = multiprocessing.Process(
            target=_policy_read_worker,
            args=(str(root), candidate, child),
        )
        policy_worker.start()
        child.close()
        with self._state_lock:
            self._policy_process = policy_worker
            cancelled = self._cancelled.is_set()
        if cancelled and policy_worker.is_alive():
            policy_worker.terminate()
        try:
            policy_worker.join(max(0, deadline - time.monotonic()))
            if policy_worker.is_alive():
                policy_worker.terminate()
                policy_worker.join()
                raise SearchError("search_timed_out", "Repository search timed out.")
            self._raise_if_cancelled()
            if not parent.poll():
                raise SearchError("search_failed", "Repository search failed.")
            result = parent.recv()
            if result[0] == "error":
                raise RepositoryFileError(result[1], result[2])
        finally:
            with self._state_lock:
                if self._policy_process is policy_worker:
                    self._policy_process = None
            parent.close()
            if policy_worker.is_alive():
                policy_worker.terminate()
            policy_worker.join()

    @staticmethod
    def _validate_glob(glob: str | None) -> None:
        if glob is None:
            return
        supplied = PurePath(glob)
        windows = PureWindowsPath(glob)
        if (
            not glob
            or "\0" in glob
            or supplied.is_absolute()
            or windows.is_absolute()
            or windows.drive
            or ".." in supplied.parts
            or ".." in windows.parts
        ):
            raise SearchError("unsafe_glob", "The requested glob is not safe.")

    @staticmethod
    def _normalize_search_path(path: str) -> str:
        windows = PureWindowsPath(path)
        if windows.is_absolute() or windows.drive or ".." in windows.parts:
            raise SearchError("unsafe_path", "The requested path is outside the repository.")
        try:
            return normalize_repository_relative_path(path)
        except RepositoryFileError as error:
            raise SearchError(error.code, error.detail) from error

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
            if not isinstance(event, dict):
                raise SearchError("search_failed", "Repository search returned invalid data.")
            if event.get("type") != "match":
                continue
            data = event.get("data", {})
            if not isinstance(data, dict):
                raise SearchError("search_failed", "Repository search returned invalid data.")
            path_data = data.get("path")
            lines_data = data.get("lines")
            if not isinstance(path_data, dict) or not isinstance(lines_data, dict):
                raise SearchError("search_failed", "Repository search returned invalid data.")
            path = path_data.get("text")
            text = lines_data.get("text")
            if text is None and isinstance(lines_data.get("bytes"), str):
                text = ""
            line = data.get("line_number")
            submatches = data.get("submatches", [])
            if (
                not isinstance(path, str)
                or not isinstance(text, str)
                or not isinstance(line, int)
                or not isinstance(submatches, list)
                or any(not isinstance(submatch, dict) for submatch in submatches)
            ):
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
        files: ConfinedRepositoryFiles,
        match: SearchMatch,
        request: SearchRequest,
        deadline: float,
    ) -> SearchMatch | None:
        if time.monotonic() >= deadline:
            raise SearchError("search_timed_out", "Repository search timed out.")
        start = max(1, match.line - request.context_before)
        end = match.line + request.context_after
        try:
            read = files.read_file(match.path, start, end)
        except RepositoryFileError as error:
            if error.code in {"binary_file", "file_too_large", "file_not_found"}:
                return None
            raise SearchError(
                "search_failed", "A search result could not be verified safely."
            ) from error
        if time.monotonic() >= deadline:
            raise SearchError("search_timed_out", "Repository search timed out.")
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
        has_context = any(match.before or match.after for match in result.matches)
        without_context = (
            replace(
                result,
                matches=tuple(replace(match, before=(), after=()) for match in result.matches),
                truncated=True,
                truncation_reasons=cls._add_reason(result.truncation_reasons, "context"),
            )
            if has_context
            else result
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
                truncated=True,
                truncation_reasons=cls._add_reason(without_context.truncation_reasons, "bytes"),
            )
            if cls._serialized_size(candidate) <= max_bytes:
                return candidate
        empty = replace(
            without_context,
            matches=(),
            match_count=0,
            truncated=True,
            truncation_reasons=cls._add_reason(without_context.truncation_reasons, "bytes"),
        )
        if cls._serialized_size(empty) > max_bytes:
            raise SearchError("result_bytes_limit", "The search result exceeds its byte budget.")
        return empty

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
