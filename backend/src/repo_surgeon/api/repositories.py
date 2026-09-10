"""Typed HTTP boundary for registering and retrieving local repositories."""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.application.repositories import (
    GetRepository,
    RegisterLocalRepository,
    RepositoryRegistrationError,
)
from repo_surgeon.domain.repositories import Repository
from repo_surgeon.infrastructure.local_repository_root import GitLocalRepositoryRootResolver
from repo_surgeon.infrastructure.repository_store import SqlAlchemyRepositoryStore

router = APIRouter(prefix="/repositories", tags=["repositories"])


class RegisterRepositoryRequest(BaseModel):
    """Input for a user-selected local Git worktree."""

    path: str = Field(min_length=1, max_length=4096)


class RepositoryResponse(BaseModel):
    """Public representation of a registered repository."""

    id: UUID
    source: Literal["local"]
    canonical_root: str
    created_at: datetime


class ProblemDetail(BaseModel):
    """Stable, typed problem response for expected client errors."""

    type: str
    title: str
    status: int
    detail: str
    code: str


class RepositoryProblem(Exception):
    """Expected repository failure rendered as an RFC 7807-style response."""

    def __init__(self, problem: ProblemDetail) -> None:
        self.problem = problem


def _response(repository: Repository) -> RepositoryResponse:
    """Convert a domain entity into an API response."""
    return RepositoryResponse(
        id=repository.id,
        source=repository.source.value,
        canonical_root=repository.canonical_root,
        created_at=repository.created_at,
    )


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Obtain the per-request session factory installed by the application factory."""
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        yield session


SessionDependency = Annotated[AsyncSession, Depends(get_session)]


def _registration_problem(error: RepositoryRegistrationError) -> RepositoryProblem:
    """Map deterministic registration failures to a stable problem-details body."""
    status_code = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if error.code == "repository_validation_unavailable"
        else status.HTTP_422_UNPROCESSABLE_CONTENT
    )
    return RepositoryProblem(
        ProblemDetail(
            type=f"https://repo-surgeon.local/problems/{error.code}",
            title="Repository registration failed",
            status=status_code,
            detail=error.detail,
            code=error.code,
        )
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=RepositoryResponse,
    responses={422: {"model": ProblemDetail}, 503: {"model": ProblemDetail}},
    summary="Register an existing local Git repository",
)
async def register_repository(
    body: RegisterRepositoryRequest, session: SessionDependency
) -> RepositoryResponse:
    """Register a canonical local Git worktree without reading its source files."""
    service = RegisterLocalRepository(
        GitLocalRepositoryRootResolver(), SqlAlchemyRepositoryStore(session)
    )
    try:
        repository = await service.execute(body.path)
    except RepositoryRegistrationError as error:
        raise _registration_problem(error) from error
    return _response(repository)


@router.get(
    "/{repository_id}",
    response_model=RepositoryResponse,
    responses={404: {"model": ProblemDetail}},
    summary="Retrieve a registered repository",
)
async def get_repository(repository_id: UUID, session: SessionDependency) -> RepositoryResponse:
    """Retrieve one durable repository record."""
    repository = await GetRepository(SqlAlchemyRepositoryStore(session)).execute(repository_id)
    if repository is None:
        raise RepositoryProblem(
            ProblemDetail(
                type="https://repo-surgeon.local/problems/repository_not_found",
                title="Repository not found",
                status=status.HTTP_404_NOT_FOUND,
                detail="No registered repository has this identifier.",
                code="repository_not_found",
            )
        )
    return _response(repository)
