"""Deterministic HTTP integration coverage for the GitHub identity-only flow."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import select

from repo_surgeon.infrastructure.github_oauth import HttpxGitHubOAuthClient
from repo_surgeon.infrastructure.repository_models import (
    AuthSessionRecord,
    GitHubIdentityRecord,
    OAuthTransactionRecord,
)
from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


def _settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        environment="test",
        access_mode="public_authenticated",
        public_origin="https://surgeon.example",
        github_oauth_client_id="test-client-id",
        github_oauth_client_secret="test-client-secret",
        auth_encryption_key="test-encryption-key",
        csrf_trusted_origins=["http://localhost:3000"],
        cookie_secure=True,
        local_repository_access=False,
    )


async def _upgrade(database_url: str) -> None:
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, config, "head")


@pytest.fixture
async def oauth_app(tmp_path: Path) -> AsyncIterator[tuple[FastAPI, list[httpx.Request]]]:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'oauth.sqlite3'}"
    await _upgrade(database_url)
    requests: list[httpx.Request] = []

    def provider(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("access_token"):
            return httpx.Response(200, json={"access_token": "github-token-that-must-not-persist"})
        if request.url.path == "/user":
            return httpx.Response(
                200,
                json={
                    "id": 42,
                    "node_id": "U_42",
                    "login": "repo-surgeon",
                    "name": "Repo Surgeon",
                    "avatar_url": "https://avatars.githubusercontent.com/u/42",
                    "html_url": "https://github.com/repo-surgeon",
                    "type": "User",
                },
            )
        return httpx.Response(404)

    app = create_app(_settings(database_url))
    provider_client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    app.state.github_oauth_client = HttpxGitHubOAuthClient(
        app.state.settings, client=provider_client
    )
    try:
        yield app, requests
    finally:
        await provider_client.aclose()
        await app.state.engine.dispose()


async def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="https://surgeon.example",
        follow_redirects=False,
    )


async def _start(client: httpx.AsyncClient) -> tuple[str, dict[str, list[str]]]:
    response = await client.get("/api/v1/auth/github/start")
    assert response.status_code == 303
    assert response.headers["cache-control"] == "no-store"
    assert "__Host-repo_surgeon_oauth=" in response.headers["set-cookie"]
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["https://surgeon.example/api/v1/auth/github/callback"]
    assert "scope" not in query
    return query["state"][0], query


@pytest.mark.anyio
async def test_github_callback_exchanges_pkce_once_and_never_persists_provider_token(
    oauth_app: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, requests = oauth_app
    async with await _client(app) as client:
        state, query = await _start(client)
        callback = await client.get(
            "/api/v1/auth/github/callback", params={"state": state, "code": "one-time-code"}
        )
        assert callback.status_code == 303
        assert callback.headers["location"] == "/auth/callback"
        assert "one-time-code" not in callback.headers["location"]
        assert state not in callback.headers["location"]
        assert "__Host-repo_surgeon_session=" in callback.headers["set-cookie"]
        assert "HttpOnly; Path=/; SameSite=lax; Secure" in callback.headers["set-cookie"]
        session = await client.get("/api/v1/auth/session")
        assert session.status_code == 200
        assert session.headers["cache-control"] == "no-store"
        assert session.json()["user"] == {
            "display_name": "Repo Surgeon",
            "github_login": "repo-surgeon",
            "github_avatar_url": "https://avatars.githubusercontent.com/u/42",
            "github_profile_url": "https://github.com/repo-surgeon",
        }
        assert session.json()["csrf_token"]

    assert len(requests) == 2
    token_request, user_request = requests
    token_form = parse_qs(token_request.content.decode())
    assert token_form["code"] == ["one-time-code"]
    assert token_form["redirect_uri"] == ["https://surgeon.example/api/v1/auth/github/callback"]
    assert token_form["code_verifier"]
    assert query["code_challenge"] != token_form["code_verifier"]
    assert user_request.headers["Authorization"] == "Bearer github-token-that-must-not-persist"
    async with app.state.session_factory() as database:
        identity = (await database.execute(select(GitHubIdentityRecord))).scalar_one()
        transaction = (await database.execute(select(OAuthTransactionRecord))).scalar_one()
        serialized = (
            f"{identity.login} {identity.github_node_id} {transaction.encrypted_pkce_verifier}"
        )
    assert "github-token-that-must-not-persist" not in serialized
    assert "one-time-code" not in serialized


@pytest.mark.anyio
async def test_callback_rejects_missing_wrong_replayed_and_browser_swapped_state_before_exchange(
    oauth_app: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, requests = oauth_app
    async with await _client(app) as first, await _client(app) as second:
        missing = await first.get("/api/v1/auth/github/callback", params={"code": "secret-code"})
        assert missing.headers["location"] == "/login?error=oauth_state_invalid"
        await _start(first)
        wrong = await first.get(
            "/api/v1/auth/github/callback", params={"state": "wrong", "code": "x"}
        )
        assert wrong.headers["location"] == "/login?error=oauth_state_invalid"
        state, _ = await _start(first)
        swapped = await second.get(
            "/api/v1/auth/github/callback", params={"state": state, "code": "x"}
        )
        assert swapped.headers["location"] == "/login?error=oauth_state_invalid"
        success = await first.get(
            "/api/v1/auth/github/callback", params={"state": state, "code": "x"}
        )
        assert success.status_code == 303
        replay = await first.get(
            "/api/v1/auth/github/callback", params={"state": state, "code": "x"}
        )
        assert replay.headers["location"] == "/login?error=oauth_state_invalid"
    assert len(requests) == 2


@pytest.mark.anyio
async def test_expired_callback_and_provider_denial_do_not_exchange_or_create_session(
    oauth_app: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, requests = oauth_app
    async with await _client(app) as client:
        state, _ = await _start(client)
        async with app.state.session_factory() as database:
            transaction = (await database.execute(select(OAuthTransactionRecord))).scalar_one()
            transaction.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await database.commit()
        expired = await client.get(
            "/api/v1/auth/github/callback", params={"state": state, "code": "x"}
        )
        assert expired.headers["location"] == "/login?error=oauth_state_invalid"
        denial_state, _ = await _start(client)
        denial = await client.get(
            "/api/v1/auth/github/callback", params={"state": denial_state, "error": "access_denied"}
        )
        assert denial.headers["location"] == "/login?error=access_denied"
        assert (await client.get("/api/v1/auth/session")).status_code == 401
    assert not requests


@pytest.mark.anyio
async def test_successful_login_rotates_existing_session_and_logout_enforces_origin_and_csrf(
    oauth_app: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, _ = oauth_app
    async with await _client(app) as client:
        first_state, _ = await _start(client)
        await client.get(
            "/api/v1/auth/github/callback", params={"state": first_state, "code": "first"}
        )
        first_cookie = client.cookies["__Host-repo_surgeon_session"]
        second_state, _ = await _start(client)
        await client.get(
            "/api/v1/auth/github/callback", params={"state": second_state, "code": "second"}
        )
        second_cookie = client.cookies["__Host-repo_surgeon_session"]
        assert second_cookie != first_cookie
        async with app.state.session_factory() as database:
            sessions = (await database.execute(select(AuthSessionRecord))).scalars().all()
            assert len(sessions) == 2
            assert sum(record.revoked_at is not None for record in sessions) == 1
        current = await client.get("/api/v1/auth/session")
        csrf = current.json()["csrf_token"]
        assert (
            await client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
        ).status_code == 403
        assert (
            await client.post(
                "/api/v1/auth/logout",
                headers={"Origin": "https://attacker.example", "X-CSRF-Token": csrf},
            )
        ).status_code == 403
        assert (
            await client.post(
                "/api/v1/auth/logout",
                headers={"Origin": "https://surgeon.example", "X-CSRF-Token": "wrong"},
            )
        ).status_code == 403
        logout = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://surgeon.example", "X-CSRF-Token": csrf},
        )
        assert logout.status_code == 204
        assert logout.headers["cache-control"] == "no-store"
        assert "__Host-repo_surgeon_session=" in logout.headers["set-cookie"]
        assert (await client.get("/api/v1/auth/session")).status_code == 401
        assert (
            await client.post(
                "/api/v1/auth/logout",
                headers={"Origin": "http://localhost:3000", "X-CSRF-Token": csrf},
            )
        ).status_code == 204
        # An already-cleared browser logout stays safe and idempotent with a trusted Origin.
        assert (
            await client.post(
                "/api/v1/auth/logout",
                headers={"Origin": "https://surgeon.example", "X-CSRF-Token": csrf},
            )
        ).status_code == 204
