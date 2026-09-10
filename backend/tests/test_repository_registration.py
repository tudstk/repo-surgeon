"""End-to-end HTTP coverage for local repository registration."""

import asyncio
import os
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncEngine

from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


def _initialize_git_repository(path: Path) -> Path:
    """Create the smallest real Git worktree required by registration."""
    path.mkdir()
    subprocess.run(["git", "init", "--quiet", str(path)], check=True)
    return path


async def _upgrade_database(database_url: str) -> None:
    """Apply the production migration chain without blocking an async test loop."""
    configuration = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    configuration.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, configuration, "head")


async def _client_for_database(database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    """Yield an API client backed by a migrated database."""
    app = create_app(Settings(database_url=database_url))
    engine: AsyncEngine = app.state.engine
    await _upgrade_database(database_url)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as test_client:
            yield test_client
    finally:
        await engine.dispose()


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    """Provide an API client backed by a temporary migration-created database."""
    database_path = tmp_path / "repositories.sqlite3"
    async for test_client in _client_for_database(f"sqlite+aiosqlite:///{database_path}"):
        yield test_client


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


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("method", "url", "payload"),
    [
        ("post", "/repositories", {}),
        ("get", "/repositories/not-a-uuid", None),
    ],
)
async def test_request_validation_uses_problem_details(
    client: httpx.AsyncClient, method: str, url: str, payload: dict[str, str] | None
) -> None:
    """Malformed registration bodies and identifiers share the documented error contract."""
    response = await client.request(method, url, json=payload)

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json() == {
        "type": "https://repo-surgeon.local/problems/request_validation_failed",
        "title": "Request validation failed",
        "status": 422,
        "detail": "Request data does not match the required API contract.",
        "code": "request_validation_failed",
    }


@pytest.mark.anyio
@pytest.mark.postgres
async def test_postgresql_registration_uses_the_migration_chain(tmp_path: Path) -> None:
    """Exercise registration through the Alembic migration on a disposable PostgreSQL database."""
    database_url = os.environ.get("REPO_SURGEON_TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("set REPO_SURGEON_TEST_DATABASE_URL to run PostgreSQL integration coverage")
    if database_url == Settings().database_url:
        pytest.fail("REPO_SURGEON_TEST_DATABASE_URL must name a disposable database")

    repository_root = _initialize_git_repository(tmp_path / "postgres-example")
    async for test_client in _client_for_database(database_url):
        response = await test_client.post("/repositories", json={"path": str(repository_root)})

    assert response.status_code == 201
    assert response.json()["canonical_root"] == str(repository_root.resolve())
