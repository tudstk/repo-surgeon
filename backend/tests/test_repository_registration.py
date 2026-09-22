"""End-to-end HTTP coverage for local repository registration."""

import asyncio
import os
import shutil
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

    listed = await client.get("/repositories")

    assert listed.status_code == 200
    assert listed.json() == [{"id": body["id"], "name": "example"}]
    assert "canonical_root" not in listed.json()[0]

    preflight = await client.options(
        "/repositories",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"

    blocked = await client.get("/repositories", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in blocked.headers


@pytest.mark.anyio
async def test_api_rejects_non_loopback_clients(tmp_path: Path) -> None:
    database_path = tmp_path / "repositories.sqlite3"
    app = create_app(Settings(database_url=f"sqlite+aiosqlite:///{database_path}"))
    transport = httpx.ASGITransport(app=app, client=("192.0.2.1", 1234))

    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health/live")

    assert response.status_code == 403
    assert response.json()["code"] == "local_only"


@pytest.mark.anyio
async def test_repository_summary_is_derived_from_registered_files(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    repository_root = _initialize_git_repository(tmp_path / "summary")
    (repository_root / "main.py").write_text("print('hello')\n")

    created = await client.post("/repositories", json={"path": str(repository_root)})
    summary = await client.get(f"/repositories/{created.json()['id']}/summary")

    assert summary.status_code == 200
    assert summary.json()["language"] == "Python"
    assert summary.json()["file_count"] == 1
    assert summary.json()["approximate_lines"] == 1

    search = await client.post(
        f"/repositories/{created.json()['id']}/search",
        json={"query": "hello", "context_before": 1, "context_after": 1},
    )

    assert search.status_code == 200
    assert search.json()["match_count"] == 1
    assert search.json()["matches"][0]["text"] == "print('hello')"
    assert search.json()["matches"][0]["before"] == []
    assert search.json()["matches"][0]["after"] == []

    duplicate_identity = await client.post(
        f"/repositories/{created.json()['id']}/search",
        json={"repository_id": str(created.json()["id"]), "query": "hello"},
    )
    assert duplicate_identity.status_code == 422


@pytest.mark.anyio
async def test_seeded_investigation_journey_returns_ranked_hypothesis(
    client: httpx.AsyncClient,
) -> None:
    fixture_root = Path(__file__).parent / "fixtures" / "repos" / "m4-session-expiry"
    git_metadata = fixture_root / ".git"
    subprocess.run(["git", "init", "--quiet", str(fixture_root)], check=True)
    try:
        registered = await client.post("/repositories", json={"path": str(fixture_root)})
        assert registered.status_code == 201

        investigation = await client.post(
            f"/repositories/{registered.json()['id']}/investigations",
            json={"question": "Why do users get logged out after their session expires?"},
        )

        assert investigation.status_code == 200
        result = investigation.json()
        assert result["status"] == "complete"
        assert result["question"] == "Why do users get logged out after their session expires?"
        assert result["hypotheses"][0]["title"] == "Expiry path may leave stale session state"
        assert result["hypotheses"][0]["confidence"] == "medium"
        assert "def expire" in result["hypotheses"][0]["evidence"][0]["excerpt"]
        assert "return token" in result["hypotheses"][0]["evidence"][0]["excerpt"]
    finally:
        shutil.rmtree(git_metadata, ignore_errors=True)


@pytest.mark.anyio
async def test_repository_summary_reports_unavailable_registered_root(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    repository_root = _initialize_git_repository(tmp_path / "removed")
    created = await client.post("/repositories", json={"path": str(repository_root)})
    shutil.rmtree(repository_root)

    summary = await client.get(f"/repositories/{created.json()['id']}/summary")

    assert summary.status_code == 503
    assert summary.json() == {
        "type": "https://repo-surgeon.local/problems/repository_unavailable",
        "title": "Repository summary failed",
        "status": 503,
        "detail": "The registered repository could not be inspected.",
        "code": "repository_unavailable",
    }


@pytest.mark.anyio
async def test_registered_root_identity_rejects_a_directory_replacement(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    repository_root = _initialize_git_repository(tmp_path / "registered")
    (repository_root / "safe.txt").write_text("registered content\n")
    created = await client.post("/repositories", json={"path": str(repository_root)})
    repository_id = created.json()["id"]

    original_root = tmp_path / "original"
    repository_root.rename(original_root)
    replacement_root = _initialize_git_repository(repository_root)
    (replacement_root / "safe.txt").write_text("replacement content\n")

    summary = await client.get(f"/repositories/{repository_id}/summary")
    search = await client.post(
        f"/repositories/{repository_id}/search", json={"query": "replacement"}
    )
    repeated_registration = await client.post("/repositories", json={"path": str(replacement_root)})

    assert summary.status_code == 503
    assert summary.json()["code"] == "repository_unavailable"
    assert search.status_code == 422
    assert search.json()["code"] == "repository_unavailable"
    assert repeated_registration.status_code == 422
    assert repeated_registration.json()["code"] == "repository_identity_changed"


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
