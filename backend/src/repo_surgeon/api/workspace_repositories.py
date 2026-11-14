"""Versioned owner-scoped repository discovery for the product workspace."""

import asyncio
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response, status
from pydantic import BaseModel

from repo_surgeon.api.dependencies import CurrentPrincipal, DatabaseSession
from repo_surgeon.api.problems import ProblemDetail, problem
from repo_surgeon.api.repositories import RepositorySummaryResponse
from repo_surgeon.application.repositories import GetRepository, ListRepositories
from repo_surgeon.application.repository_files import RepositoryFileError
from repo_surgeon.application.repository_intelligence import detect_repository_summary
from repo_surgeon.infrastructure.github_repository_search import (
    SEARCH_PATTERN,
    GitHubRepositorySearch,
    GitHubRepositorySearchError,
    PublicGitHubRepository,
)
from repo_surgeon.infrastructure.repository_store import SqlAlchemyRepositoryStore

router = APIRouter(prefix="/api/v1/repositories", tags=["workspace repositories"])


class WorkspaceRepositoryResponse(BaseModel):
    """A safe owned-repository identity that never exposes its host root."""

    id: UUID
    name: str


def _not_found() -> Exception:
    return problem(
        code="repository_not_found",
        title="Repository not found",
        status=status.HTTP_404_NOT_FOUND,
        detail="No owned repository has this identifier.",
    )


@router.get("", response_model=list[WorkspaceRepositoryResponse])
async def list_owned_repositories(
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[WorkspaceRepositoryResponse]:
    """List only repositories owned by the current tenant."""
    response.headers["Cache-Control"] = "no-store"
    repositories = await ListRepositories(
        SqlAlchemyRepositoryStore(database, principal.user_id)
    ).execute()
    return [
        WorkspaceRepositoryResponse(id=repository.id, name=Path(repository.canonical_root).name)
        for repository in repositories
    ]


@router.get(
    "/github/search",
    responses={429: {"model": ProblemDetail}, 502: {"model": ProblemDetail}},
)
async def search_public_github_repositories(
    request: Request,
    response: Response,
    _principal: CurrentPrincipal,
    q: Annotated[str, Query(min_length=3, max_length=100, pattern=SEARCH_PATTERN)],
) -> list[PublicGitHubRepository]:
    """Return public suggestions for a signed-in workspace user."""
    response.headers["Cache-Control"] = "no-store"
    search: GitHubRepositorySearch = request.app.state.github_repository_search
    try:
        return await search.search(q)
    except GitHubRepositorySearchError as error:
        if error.rate_limited:
            raise problem(
                code="github_search_rate_limited",
                title="GitHub search rate limit reached",
                status=429,
                detail="Try searching again in a minute.",
            ) from error
        raise problem(
            code="github_search_unavailable",
            title="GitHub search unavailable",
            status=502,
            detail="GitHub could not return repository suggestions.",
        ) from error


@router.get(
    "/{repository_id}/summary",
    response_model=RepositorySummaryResponse,
    responses={404: {"model": ProblemDetail}},
)
async def get_owned_repository_summary(
    repository_id: UUID,
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> RepositorySummaryResponse:
    """Inspect bounded metadata only after the owner-scoped capability lookup."""
    response.headers["Cache-Control"] = "no-store"
    repository = await GetRepository(
        SqlAlchemyRepositoryStore(database, principal.user_id)
    ).execute(repository_id)
    if repository is None:
        raise _not_found()
    if repository.root_device is None or repository.root_inode is None:
        raise problem(
            code="repository_unavailable",
            title="Repository unavailable",
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The owned repository is unavailable.",
        )
    try:
        summary = await asyncio.to_thread(
            detect_repository_summary,
            repository.canonical_root,
            expected_root_identity=(repository.root_device, repository.root_inode),
        )
    except RepositoryFileError as error:
        raise problem(
            code=error.code,
            title="Repository summary failed",
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The owned repository could not be inspected.",
        ) from error
    return RepositorySummaryResponse.from_summary(summary)
