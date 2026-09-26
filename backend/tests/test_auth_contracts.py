"""Authentication configuration and public-mode safety contracts."""

from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


def public_settings(database_url: str) -> Settings:
    """Build deterministic public settings without contacting an OAuth provider."""
    return Settings(
        database_url=database_url,
        access_mode="public_authenticated",
        public_origin="https://surgeon.example",
        github_oauth_client_id="test-client-id",
        github_oauth_client_secret="test-client-secret",
        auth_encryption_key="test-encryption-key",
        cookie_secure=True,
        local_repository_access=False,
    )


def test_public_settings_expose_a_fixed_callback_and_session_policy() -> None:
    settings = public_settings("sqlite+aiosqlite:///settings.sqlite3")

    assert settings.oauth_callback_url == "https://surgeon.example/api/v1/auth/github/callback"
    assert settings.session_idle_ttl_seconds == 43_200
    assert settings.session_absolute_ttl_seconds == 604_800
    assert settings.oauth_transaction_ttl_seconds == 600


@pytest.mark.parametrize("environment", ["development", "test"])
def test_public_settings_require_secure_cookies_in_non_production_environments(
    environment: str,
) -> None:
    values = public_settings("sqlite+aiosqlite:///settings.sqlite3").model_dump()
    values.update(environment=environment, cookie_secure=False)

    with pytest.raises(ValidationError, match="public_authenticated requires secure cookies"):
        Settings(**values)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"public_origin": "https://surgeon.example/app"}, "PUBLIC_ORIGIN"),
        (
            {"public_origin": "[http://127.0.0.1:3000](http://127.0.0.1:3000)"},
            "PUBLIC_ORIGIN",
        ),
        ({"cors_allowed_origins": ["*"]}, "CORS_ALLOWED_ORIGINS"),
        ({"local_repository_access": True}, "LOCAL_REPOSITORY_ACCESS"),
        (
            {"github_oauth_callback_url": "https://evil.example/callback"},
            "GITHUB_OAUTH_CALLBACK_URL",
        ),
    ],
)
def test_public_settings_fail_closed_for_unsafe_overrides(
    overrides: dict[str, object], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        values = public_settings("sqlite+aiosqlite:///settings.sqlite3").model_dump()
        values.update(overrides)
        Settings(**values)


def test_production_cannot_use_local_trusted_defaults() -> None:
    with pytest.raises(ValidationError, match="production requires public_authenticated"):
        Settings(environment="production")


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+asyncpg://repo_surgeon:repo_surgeon_local_only@127.0.0.1:5432/repo_surgeon?x=1",
        "postgresql+asyncpg://repo_surgeon:repo_surgeon_local_only@127.0.0.1:5432/repo_surgeon/",
    ],
)
def test_production_rejects_local_database_variants(database_url: str) -> None:
    values = public_settings(database_url).model_dump()
    values.update(environment="production", public_origin="https://surgeon.example")

    with pytest.raises(ValidationError, match="local development database"):
        Settings(**values)


def test_production_accepts_non_local_database() -> None:
    values = public_settings(
        "postgresql+asyncpg://app:secret@db.example:5432/repo_surgeon"
    ).model_dump()
    values.update(environment="production", public_origin="https://surgeon.example")

    settings = Settings(**values)

    assert settings.environment == "production"


@pytest.mark.anyio
async def test_public_mode_rejects_local_registration_at_http_boundary(tmp_path: Path) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'public.sqlite3'}"
    app = create_app(public_settings(database_url))
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/repositories", json={"path": str(tmp_path)})

    await app.state.engine.dispose()
    assert response.status_code == 403
    assert response.json()["code"] == "local_repository_access_disabled"
