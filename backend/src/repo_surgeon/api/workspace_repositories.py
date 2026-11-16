"""Versioned owner-scoped repository discovery for the product workspace."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING, Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response, status
from pydantic import BaseModel, Field

from repo_surgeon.api.dependencies import CurrentPrincipal, DatabaseSession, MutationPrincipal
from repo_surgeon.api.problems import ProblemDetail, problem
from repo_surgeon.api.repositories import RepositorySummaryResponse
from repo_surgeon.application.repositories import (
    GetRepository,
    ListRepositories,
    RepositoryRegistrationError,
)
from repo_surgeon.application.repository_files import (
    BROWSER_SCAN_LIMIT,
    MAX_FILE_BYTES,
    MAX_PREVIEW_LINES,
    ConfinedRepositoryFiles,
    DirectoryPage,
    FileRead,
    RepositoryFileError,
)
from repo_surgeon.application.repository_intelligence import detect_repository_summary
from repo_surgeon.domain.repositories import RepositorySource
from repo_surgeon.infrastructure.github_import import (
    FULL_NAME_PATTERN,
    GitHubImporter,
    GitHubImportError,
)
from repo_surgeon.infrastructure.github_repository_search import (
    SEARCH_PATTERN,
    GitHubRepositorySearch,
    GitHubRepositorySearchError,
    PublicGitHubRepository,
)
from repo_surgeon.infrastructure.repository_store import SqlAlchemyRepositoryStore

if TYPE_CHECKING:
    from repo_surgeon.domain.repositories import Repository

router = APIRouter(prefix="/api/v1/repositories", tags=["workspace repositories"])


class WorkspaceRepositoryResponse(BaseModel):
    """A safe owned-repository identity that never exposes its host root."""

    id: UUID
    name: str
    github_commit: str | None = None


def _not_found() -> Exception:
    return problem(
        code="repository_not_found",
        title="Repository not found",
        status=status.HTTP_404_NOT_FOUND,
        detail="No owned repository has this identifier.",
    )


@router.get("", response_model=list[WorkspaceRepositoryResponse], response_model_exclude_none=True)
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
        WorkspaceRepositoryResponse(
            id=repository.id,
            name=repository.github_full_name or Path(repository.canonical_root).name,
            github_commit=repository.github_commit,
        )
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
    q: Annotated[str, Query(min_length=1, max_length=140, pattern=SEARCH_PATTERN)],
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


class ImportGitHubRequest(BaseModel):
    full_name: str = Field(min_length=3, max_length=140, pattern=FULL_NAME_PATTERN)


@router.post(
    "/github/import", response_model=WorkspaceRepositoryResponse, response_model_exclude_none=True
)
async def import_github_repository(
    body: ImportGitHubRequest,
    request: Request,
    response: Response,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> WorkspaceRepositoryResponse:
    """Import a public snapshot and grant its capability only to the current tenant."""
    response.headers["Cache-Control"] = "no-store"
    importer: GitHubImporter = request.app.state.github_importer
    try:
        snapshot = await importer.import_public(body.full_name, principal.user_id)
    except GitHubImportError as error:
        raise problem(
            code="github_import_failed",
            title="Repository import failed",
            status=422,
            detail=str(error),
        ) from error
    try:
        repository = await SqlAlchemyRepositoryStore(database, principal.user_id).add_github(
            snapshot.root, snapshot.full_name, snapshot.commit
        )
    except RepositoryRegistrationError as error:
        raise problem(
            code="repository_unavailable",
            title="Repository unavailable",
            status=409,
            detail="The saved snapshot directory has changed. Contact the service operator.",
        ) from error
    return WorkspaceRepositoryResponse(
        id=repository.id, name=snapshot.full_name, github_commit=snapshot.commit
    )


class SnapshotSyncStatus(BaseModel):
    up_to_date: bool


async def _owned_github_snapshot(
    store: SqlAlchemyRepositoryStore, repository_id: UUID
) -> Repository:
    repository = await store.get(repository_id)
    if (
        repository is None
        or repository.source != RepositorySource.GITHUB
        or not repository.github_full_name
        or not repository.github_commit
    ):
        raise _not_found()
    return repository


@router.get("/{repository_id}/sync-status")
async def get_snapshot_sync_status(
    repository_id: UUID,
    request: Request,
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> SnapshotSyncStatus:
    response.headers["Cache-Control"] = "no-store"
    repository = await _owned_github_snapshot(
        SqlAlchemyRepositoryStore(database, principal.user_id), repository_id
    )
    importer: GitHubImporter = request.app.state.github_importer
    try:
        latest = await importer.latest_commit(repository)
    except GitHubImportError as error:
        raise problem(
            code="repository_sync_status_failed",
            title="Could not check GitHub",
            status=502,
            detail=str(error),
        ) from error
    return SnapshotSyncStatus(up_to_date=latest == repository.github_commit)


@router.post("/{repository_id}/sync", response_model_exclude_none=True)
async def sync_owned_snapshot(
    repository_id: UUID,
    request: Request,
    response: Response,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> WorkspaceRepositoryResponse:
    """Register a new pinned revision while retaining existing session references."""
    response.headers["Cache-Control"] = "no-store"
    store = SqlAlchemyRepositoryStore(database, principal.user_id)
    repository = await _owned_github_snapshot(store, repository_id)
    importer: GitHubImporter = request.app.state.github_importer
    try:
        snapshot = await importer.sync_public(repository)
        if snapshot is not None:
            repository = await store.add_github(snapshot.root, snapshot.full_name, snapshot.commit)
    except GitHubImportError as error:
        raise problem(
            code="repository_sync_failed",
            title="Could not sync repository",
            status=422,
            detail=str(error),
        ) from error
    except RepositoryRegistrationError as error:
        raise problem(
            code="repository_unavailable",
            title="Repository unavailable",
            status=409,
            detail="The latest snapshot directory has changed. Contact the service operator.",
        ) from error
    return WorkspaceRepositoryResponse(
        id=repository.id,
        name=repository.github_full_name or Path(repository.canonical_root).name,
        github_commit=repository.github_commit,
    )


@router.post("/{repository_id}/recover", status_code=204)
async def recover_owned_snapshot(
    repository_id: UUID,
    request: Request,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> Response:
    """Verify the original pinned snapshot before recovering its device binding."""
    store = SqlAlchemyRepositoryStore(database, principal.user_id)
    repository = await store.get(repository_id)
    if repository is None or repository.source != RepositorySource.GITHUB:
        raise _not_found()
    importer: GitHubImporter = request.app.state.github_importer
    try:
        verified = await importer.verify_saved(repository)
    except GitHubImportError as error:
        raise problem(
            code="repository_recovery_failed",
            title="Snapshot recovery failed",
            status=422,
            detail=str(error),
        ) from error
    if not await store.recover_github_device(repository, verified):
        raise problem(
            code="repository_recovery_conflict",
            title="Snapshot registration changed",
            status=409,
            detail="Reload the workspace before retrying recovery.",
        )
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


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


def _repository_browser(repository: Repository) -> ConfinedRepositoryFiles:
    if repository.root_device is None or repository.root_inode is None:
        raise RepositoryFileError("repository_unavailable", "The repository is unavailable.")
    return ConfinedRepositoryFiles(
        repository.canonical_root, (repository.root_device, repository.root_inode)
    )


def _browse_problem(error: RepositoryFileError) -> Exception:
    status_code = {
        "repository_unavailable": 503,
        "file_not_found": 404,
        "unsafe_path": 404,
        "binary_file": 415,
        "file_too_large": 413,
    }.get(error.code, 400)
    return problem(
        code=error.code,
        title="Repository preview unavailable",
        status=status_code,
        detail=error.detail,
    )


@router.get("/{repository_id}/tree")
async def browse_owned_repository(
    repository_id: UUID,
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    directory: Annotated[str, Query(min_length=1, max_length=1024)] = ".",
    offset: Annotated[int, Query(ge=0, le=BROWSER_SCAN_LIMIT)] = 0,
) -> DirectoryPage:
    response.headers["Cache-Control"] = "no-store"
    repository = await SqlAlchemyRepositoryStore(database, principal.user_id).get(repository_id)
    if repository is None:
        raise _not_found()

    def browse() -> DirectoryPage:
        return _repository_browser(repository).browse_directory(directory, offset)

    try:
        return await asyncio.to_thread(browse)
    except RepositoryFileError as error:
        raise _browse_problem(error) from error


class FilePreviewResponse(BaseModel):
    path: str
    start_line: int
    end_line: int
    lines: list[str]
    has_more: bool

    @classmethod
    def from_read(cls, result: FileRead) -> FilePreviewResponse:
        return cls(
            path=result.path,
            start_line=result.start_line,
            end_line=result.end_line,
            lines=[line.text for line in result.lines],
            has_more=result.truncated,
        )


@router.get("/{repository_id}/file")
async def preview_owned_repository_file(
    repository_id: UUID,
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    path: Annotated[str, Query(min_length=1, max_length=1024)],
    start_line: Annotated[int, Query(ge=1, le=MAX_FILE_BYTES + 1)] = 1,
) -> FilePreviewResponse:
    response.headers["Cache-Control"] = "no-store"
    repository = await SqlAlchemyRepositoryStore(database, principal.user_id).get(repository_id)
    if repository is None:
        raise _not_found()

    def read() -> FileRead:
        return _repository_browser(repository).read_file(
            path, start_line, allow_unicode_bom=True, max_lines=MAX_PREVIEW_LINES
        )

    try:
        return FilePreviewResponse.from_read(await asyncio.to_thread(read))
    except RepositoryFileError as error:
        raise _browse_problem(error) from error


class RepositoryVisibilityRequest(BaseModel):
    hidden: bool


@router.post("/{repository_id}/visibility", status_code=204)
async def set_repository_visibility(
    repository_id: UUID,
    body: RepositoryVisibilityRequest,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> Response:
    """Remove from or restore to the owner's list; keep stored data intact."""
    if not await SqlAlchemyRepositoryStore(database, principal.user_id).set_hidden(
        repository_id, body.hidden
    ):
        raise _not_found()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
