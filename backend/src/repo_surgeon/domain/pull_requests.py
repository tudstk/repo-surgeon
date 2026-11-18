"""Read-only file changes from a pull request, independent of its transport."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class GitHubPullRequestFile:
    path: str
    previous_path: str | None
    status: str
    additions: int
    deletions: int
    patch: str | None
    patch_status: Literal["available", "unavailable", "limited", "restricted"]
