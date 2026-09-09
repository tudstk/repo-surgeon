"""End-to-end HTTP coverage for local repository registration."""

import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from repo_surgeon.infrastructure.repository_models import Base
from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


def _initialize_git_repository(path: Path) -> Path:
    """Create the smallest real Git worktree required by registration."""
    path.mkdir()
    subprocess.run(["git", "init", "--quiet", str(path)], check=True)
    return path


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    """Provide an API client backed by a temporary SQLite database."""
    database_path = tmp_path / "repositories.sqlite3"
    app = create_app(Settings(database_url=f"sqlite+aiosqlite:///{database_path}"))
    engine: AsyncEngine = app.state.engine
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client

    await engine.dispose()


@pytest.mark.anyio
async def test_registers_and_retrieves_a_canonical_git_root(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    """A user can persist and later retrieve a selected local repository."""
    repository_root = _initialize_git_repository(tmp_path / "example")

    created = await client.post("/repositories", json={"path": str(repository_root)})

    assert created.status_code == 201
    body = created.json()
    assert body["source"] == "local"
    assert body["canonical_root"] == str(repository_root.resolve())
    assert body["id"]
    assert body["created_at"]

    retrieved = await client.get(f"/repositories/{body['id']}")

    assert retrieved.status_code == 200
    assert retrieved.json() == body


@pytest.mark.anyio
async def test_registration_is_idempotent_for_nested_and_symlinked_paths(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    """Different spellings of the same Git worktree return one durable record."""
    repository_root = _initialize_git_repository(tmp_path / "example")
    nested = repository_root / "nested"
    nested.mkdir()
    symlink = tmp_path / "repository-link"
    symlink.symlink_to(repository_root, target_is_directory=True)

    root_response = await client.post("/repositories", json={"path": str(repository_root)})
    nested_response = await client.post("/repositories", json={"path": str(nested)})
    symlink_response = await client.post("/repositories", json={"path": str(symlink)})

    assert root_response.status_code == 201
    assert nested_response.status_code == 201
    assert symlink_response.status_code == 201
    assert nested_response.json()["id"] == root_response.json()["id"]
    assert symlink_response.json()["id"] == root_response.json()["id"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "code"),
    [
        ("relative/repository", "repository_path_invalid"),
        ("/definitely/not/a/repository", "repository_path_invalid"),
    ],
)
async def test_rejects_invalid_repository_roots(
    client: httpx.AsyncClient, path: str, code: str
) -> None:
    """Invalid paths have stable client-visible problem codes."""
    response = await client.post("/repositories", json={"path": path})

    assert response.status_code == 422
    assert response.json()["code"] == code


@pytest.mark.anyio
async def test_rejects_existing_non_git_directory(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    """An existing directory cannot become a repository capability without Git validation."""
    ordinary_directory = tmp_path / "ordinary"
    ordinary_directory.mkdir()

    response = await client.post("/repositories", json={"path": str(ordinary_directory)})

    assert response.status_code == 422
    assert response.json() == {
        "type": "https://repo-surgeon.local/problems/repository_not_git",
        "title": "Repository registration failed",
        "status": 422,
        "detail": "Repository path must be inside a Git working tree.",
        "code": "repository_not_git",
    }


@pytest.mark.anyio
async def test_missing_repository_has_a_stable_problem(client: httpx.AsyncClient) -> None:
    """Unknown identifiers do not expose persistence implementation details."""
    response = await client.get("/repositories/00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404
    assert response.json()["code"] == "repository_not_found"
