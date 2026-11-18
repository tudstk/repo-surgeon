"""Bounded models for GitHub pull requests and repository-safe file patches."""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from repo_surgeon.application.repository_files import (
    RepositoryFileError,
    ensure_visible_repository_path,
)
from repo_surgeon.domain.pull_requests import GitHubPullRequestFile as GitHubPullRequestFile

PULL_REQUEST_PAGE_SIZE = 20
PULL_REQUEST_FILE_PAGE_SIZE = 5
# GitHub caps the files endpoint at 3,000 files per pull request.
MAX_PULL_REQUEST_FILES = 3_000
MAX_PULL_REQUEST_FILE_PAGE = MAX_PULL_REQUEST_FILES // PULL_REQUEST_FILE_PAGE_SIZE
_MAX_PATCH_BYTES = 96 * 1024
_MAX_PATCH_LINES = 1_500
_FILE_STATUSES = frozenset(
    {"added", "removed", "modified", "renamed", "copied", "changed", "unchanged"}
)
_SENSITIVE_DIFF = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[\w]{20,}|github_pat_[\w]{20,})\b"
)


@dataclass(frozen=True, slots=True)
class GitHubPullRequest:
    number: int
    title: str
    status: Literal["open", "draft", "closed", "merged"]
    author: str | None
    updated_at: datetime
    base_ref: str
    head_ref: str
    url: str


@dataclass(frozen=True, slots=True)
class GitHubPullRequestPage:
    pulls: list[GitHubPullRequest]
    next_page: int | None


@dataclass(frozen=True, slots=True)
class GitHubPullRequestChanges:
    changed_files: int
    additions: int
    deletions: int
    files: list[GitHubPullRequestFile]
    restricted_files: int
    next_page: int | None
    file_limit_reached: bool


def _short_text(value: object, limit: int) -> str:
    if not isinstance(value, str) or not value or len(value) > limit:
        raise ValueError
    return value


def change_count(value: object) -> int:
    if type(value) is not int or not 0 <= value <= 2**31 - 1:
        raise ValueError
    return value


def pull_request_from_github(item: object, repository: str) -> GitHubPullRequest:
    if not isinstance(item, dict):
        raise ValueError
    number = change_count(item.get("number"))
    if number == 0:
        raise ValueError
    state = item.get("state")
    if state == "open":
        status: Literal["open", "draft", "closed", "merged"] = (
            "draft" if item.get("draft") is True else "open"
        )
    elif state == "closed":
        status = "merged" if item.get("merged_at") else "closed"
    else:
        raise ValueError
    base, head, author = item.get("base"), item.get("head"), item.get("user")
    if not isinstance(base, dict) or not isinstance(head, dict):
        raise ValueError
    updated_at = datetime.fromisoformat(_short_text(item.get("updated_at"), 35))
    if updated_at.utcoffset() is None:
        raise ValueError
    return GitHubPullRequest(
        number,
        _short_text(item.get("title"), 1024),
        status,
        _short_text(author.get("login"), 100) if isinstance(author, dict) else None,
        updated_at,
        _short_text(base.get("ref"), 255),
        _short_text(head.get("ref"), 255),
        f"https://github.com/{repository}/pull/{number}",
    )


def _repository_path(value: object) -> str:
    path = _short_text(value, 1024)
    if any(part in {"", ".", ".."} for part in path.split("/")) or any(
        ord(char) < 32 or char in "\\:" for char in path
    ):
        raise RepositoryFileError("unsafe_path", "The requested path is not available.")
    ensure_visible_repository_path(path)
    return path


def pull_file_from_github(item: object) -> GitHubPullRequestFile | None:
    if not isinstance(item, dict):
        raise ValueError
    try:
        path = _repository_path(item.get("filename"))
        previous = item.get("previous_filename")
        previous_path = _repository_path(previous) if previous is not None else None
    except RepositoryFileError:
        # A rename must pass the path policy on both sides.
        return None
    status = item.get("status")
    if not isinstance(status, str) or status not in _FILE_STATUSES:
        raise ValueError
    patch = item.get("patch")
    patch_status: Literal["available", "unavailable", "limited", "restricted"] = "available"
    if not isinstance(patch, str) or not patch:
        patch, patch_status = None, "unavailable"
    elif len(patch.encode()) > _MAX_PATCH_BYTES or patch.count("\n") >= _MAX_PATCH_LINES:
        patch, patch_status = None, "limited"
    elif _SENSITIVE_DIFF.search(patch):
        patch, patch_status = None, "restricted"
    return GitHubPullRequestFile(
        path,
        previous_path,
        status,
        change_count(item.get("additions")),
        change_count(item.get("deletions")),
        patch,
        patch_status,
    )
