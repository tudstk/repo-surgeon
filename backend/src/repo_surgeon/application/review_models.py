"""Pinned pull request metadata passed to bounded read-only review services."""

from dataclasses import dataclass

from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.domain.pull_requests import GitHubPullRequestFile


@dataclass(frozen=True, slots=True)
class PullReviewSource:
    number: int
    title: str
    description: str
    base_sha: str
    head_sha: str
    files: tuple[GitHubPullRequestFile, ...]
    omitted_files: int
    root: ResolvedLocalRepositoryRoot


@dataclass(frozen=True, slots=True)
class RepositoryChatSource:
    root: ResolvedLocalRepositoryRoot
    question: str
    history: tuple[dict[str, str], ...] = ()
