"""An immutable, single-file fix revision derived from a GitHub review suggestion."""

import difflib
import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath

from repo_surgeon.application.redaction import redact_text
from repo_surgeon.application.repository_files import ensure_visible_repository_path


class FixError(Exception):
    """A safe, actionable refusal to test or publish the proposed fix."""


def source_path(path: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*", path):
        raise FixError("Choose an existing source file outside hidden directories.")
    ensure_visible_repository_path(path)
    if PurePosixPath(path).suffix not in {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}:
        raise FixError("This publisher supports Python and JavaScript/TypeScript source.")
    return path


@dataclass(frozen=True)
class Fix:
    repository: int
    owner: int
    pull: int
    suggestion: int
    base: str
    path: str
    before: str
    after: str
    image: str
    test: str

    @property
    def digest(self) -> str:
        return hashlib.sha256(json.dumps(vars(self), sort_keys=True).encode()).hexdigest()

    @property
    def branch(self) -> str:
        return f"repo-surgeon/fix-{self.pull}-{self.digest[:16]}"

    @property
    def preview_text(self) -> str:
        return (
            f"{self.diff}\nTest passed: {self.test}\nBase: {self.base}\nBranch: {self.branch}\n"
            f"Post this command after reviewing the diff:\n"
            f"/repo-surgeon approve {self.digest} {self.suggestion}"
        )

    def apply_command(self, approval: int) -> str:
        return f"/repo-surgeon apply {self.digest} {self.branch} {self.suggestion} {approval}"

    @property
    def diff(self) -> str:
        return "".join(
            difflib.unified_diff(
                self.before.splitlines(True),
                self.after.splitlines(True),
                fromfile=f"a/{self.path}",
                tofile=f"b/{self.path}",
            )
        )


def replace_suggestion(original: bytes, start: int, end: int, body: str) -> tuple[str, str]:
    if len(original) > 65536 or len(body.encode()) > 8192:
        raise FixError("The file or suggestion exceeds the review limit.")
    if b"\r" in original or not original.endswith(b"\n"):
        raise FixError("Choose a UTF-8 file with LF endings and a final newline.")
    body = body.replace("\r\n", "\n")
    matches = re.findall(r"^\x60{3}suggestion\n(.*?)^\x60{3}[ \t]*$", body, re.M | re.S)
    if len(matches) != 1:
        raise FixError("The review comment must contain one GitHub suggestion block.")
    before = original.decode("utf-8")
    replacement = matches[0]
    if any(
        unicodedata.category(c) in {"Cf", "Cc"} and c not in "\n\t" for c in before + replacement
    ):
        raise FixError("Binary and control characters are unsupported.")
    lines = before.splitlines(keepends=True)
    if not 1 <= start <= end <= len(lines) or end - start >= 100:
        raise FixError("The suggestion range is invalid or exceeds 100 lines.")
    after = "".join(lines[: start - 1]) + replacement + "".join(lines[end:])
    if before == after:
        raise FixError("The suggestion makes no change.")
    if any(redact_text(text) != text for text in (before, after)):
        raise FixError(
            "This file contains credential-like content and cannot be published by the bot."
        )
    return before, after
