"""Typed HTTP boundary for registering and retrieving local repositories."""

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.agent.investigation import InvestigationResult, investigate_repository
from repo_surgeon.application.repositories import (
    GetRepository,
    ListRepositories,
    RegisterLocalRepository,
    RepositoryRegistrationError,
)
from repo_surgeon.application.repository_files import RepositoryFileError
from repo_surgeon.application.repository_intelligence import (
    RepositorySummary,
    detect_repository_summary,
)
from repo_surgeon.domain.repositories import Repository
from repo_surgeon.evaluation.bug_investigation import seeded_behavioral_proof
from repo_surgeon.infrastructure.local_repository_root import GitLocalRepositoryRootResolver
from repo_surgeon.infrastructure.repository_store import SqlAlchemyRepositoryStore
from repo_surgeon.mcp.file_tools import McpFileTools
from repo_surgeon.mcp.search_tools import (
    McpSearchTools,
    SearchCodeArguments,
    SearchCodeInput,
    SearchCodeOutput,
)

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


class RepositoryListResponse(BaseModel):
    """Minimal repository identity for the workspace selector."""

    id: UUID
    name: str


class RepositorySearchRequest(SearchCodeArguments):
    """Bounded search input whose repository is selected by the URL."""


class RepositorySummaryResponse(BaseModel):
    """Repository-derived metadata for the workspace summary card."""

    language: str | None
    language_confidence: Literal["high", "medium", "low", "unknown"]
    file_count: int
    total_bytes: int
    approximate_lines: int | None
    test_framework: str | None
    test_command: str | None
    test_detection: Literal["detected", "ambiguous", "not_found", "unsupported"]
    detected_at: datetime
    truncated: bool

    @classmethod
    def from_summary(cls, summary: RepositorySummary) -> RepositorySummaryResponse:
        return cls(
            language=summary.language,
            language_confidence=summary.language_confidence,
            file_count=summary.file_count,
            total_bytes=summary.total_bytes,
            approximate_lines=summary.approximate_lines,
            test_framework=summary.test_framework,
            test_command=summary.test_command,
            test_detection=summary.test_detection,
            detected_at=summary.detected_at,
            truncated=summary.truncated,
        )


class InvestigationRequest(BaseModel):
    """A user question routed through the bounded read-only investigator."""

    question: str = Field(min_length=3, max_length=2_000)


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


@router.post(
    "/{repository_id}/investigations",
    response_model=InvestigationResult,
    responses={404: {"model": ProblemDetail}},
    summary="Investigate a repository bug with bounded read-only evidence",
)
async def investigate_repository_bug(
    repository_id: UUID, body: InvestigationRequest, session: SessionDependency
) -> InvestigationResult:
    repository = await GetRepository(SqlAlchemyRepositoryStore(session)).execute(repository_id)
    if repository is None:
        raise RepositoryProblem(
            ProblemDetail(
                type="https://repo-surgeon.local/problems/repository_not_found",
                title="Repository not found",
                status=404,
                detail="No registered repository has this identifier.",
                code="repository_not_found",
            )
        )
    return await investigate_repository(
        McpFileTools(SqlAlchemyRepositoryStore(session)),
        repository_id,
        body.question,
        seeded_proof=seeded_behavioral_proof(body.question),
    )


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
    "",
    response_model=list[RepositoryListResponse],
    summary="List registered local repositories",
)
async def list_repositories(session: SessionDependency) -> list[RepositoryListResponse]:
    """Return registered repositories for the workspace selector."""
    repositories = await ListRepositories(SqlAlchemyRepositoryStore(session)).execute()
    return [
        RepositoryListResponse(id=repository.id, name=Path(repository.canonical_root).name)
        for repository in repositories
    ]


@router.post(
    "/{repository_id}/search",
    response_model=SearchCodeOutput,
    responses={404: {"model": ProblemDetail}, 422: {"model": ProblemDetail}},
    summary="Search one registered repository",
)
async def search_repository(
    repository_id: UUID,
    body: RepositorySearchRequest,
    session: SessionDependency,
) -> SearchCodeOutput:
    """Run the existing bounded search adapter for a selected repository."""
    if await GetRepository(SqlAlchemyRepositoryStore(session)).execute(repository_id) is None:
        raise RepositoryProblem(
            ProblemDetail(
                type="https://repo-surgeon.local/problems/repository_not_found",
                title="Repository not found",
                status=status.HTTP_404_NOT_FOUND,
                detail="No registered repository has this identifier.",
                code="repository_not_found",
            )
        )
    result = await McpSearchTools(SqlAlchemyRepositoryStore(session)).search_code(
        SearchCodeInput(repository_id=repository_id, **body.model_dump())
    )
    if not isinstance(result, SearchCodeOutput):
        raise RepositoryProblem(
            ProblemDetail(
                type="https://repo-surgeon.local/problems/search_failed",
                title="Repository search failed",
                status=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="The bounded repository search could not be completed.",
                code=getattr(result, "code", "search_failed"),
            )
        )
    return result


def _summary_problem(error: RepositoryFileError) -> RepositoryProblem:
    """Map repository inspection failures to a stable problem response."""
    status_code = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if error.code == "repository_unavailable"
        else status.HTTP_422_UNPROCESSABLE_CONTENT
    )
    return RepositoryProblem(
        ProblemDetail(
            type=f"https://repo-surgeon.local/problems/{error.code}",
            title="Repository summary failed",
            status=status_code,
            detail="The registered repository could not be inspected.",
            code=error.code,
        )
    )


@router.get(
    "/{repository_id}/summary",
    response_model=RepositorySummaryResponse,
    responses={404: {"model": ProblemDetail}},
    summary="Detect bounded repository summary metadata",
)
async def get_repository_summary(
    repository_id: UUID, session: SessionDependency
) -> RepositorySummaryResponse:
    """Return bounded metadata detected from a registered repository root."""
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
    try:
        if repository.root_device is None or repository.root_inode is None:
            raise RepositoryFileError(
                "repository_unavailable", "The registered repository is unavailable."
            )
        summary = await asyncio.to_thread(
            detect_repository_summary,
            repository.canonical_root,
            expected_root_identity=(repository.root_device, repository.root_inode),
        )
    except RepositoryFileError as error:
        raise _summary_problem(error) from error
    return RepositorySummaryResponse.from_summary(summary)


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
