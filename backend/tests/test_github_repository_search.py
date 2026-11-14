"""Deterministic tests of the public-only GitHub discovery boundary."""

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from repo_surgeon.infrastructure.github_repository_search import GitHubRepositorySearch
from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings

_ROUTE = "/api/v1/repositories/github/search"


@pytest.fixture
async def search_api() -> AsyncIterator[tuple[FastAPI, list[httpx.Request]]]:
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.params["q"].startswith('"limited"'):
            return httpx.Response(403, headers={"X-RateLimit-Remaining": "0"})
        if request.url.params["q"].startswith('"outage"'):
            return httpx.Response(503, text="raw upstream error")
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "full_name": "pallets/flask",
                        "private": False,
                        "visibility": "public",
                        "owner": {"id": 16748505, "avatar_url": "https://untrusted.invalid/avatar"},
                    },
                    {"full_name": "other/private", "private": True},
                    {"full_name": "other/internal", "private": False, "visibility": "internal"},
                    {"full_name": "other/unknown"},
                    {"full_name": "other/..", "private": False},
                ]
            },
        )

    app = create_app(Settings(environment="test"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        app.state.github_repository_search = GitHubRepositorySearch(client=client)
        async with app.router.lifespan_context(app):
            yield app, requests


@pytest.mark.anyio
async def test_search_projects_only_safe_public_results(
    search_api: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, requests = search_api
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    ) as client:
        response = await client.get(_ROUTE, params={"q": "pallets/flask"})
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json() == [
            {
                "full_name": "pallets/flask",
                "owner_avatar_url": "https://avatars.githubusercontent.com/u/16748505?s=64",
            }
        ]
        invalid = await client.get(_ROUTE, params={"q": "flask is:private"})
        assert invalid.status_code == 422

        short_name = await client.get(_ROUTE, params={"q": "go"})
        assert short_name.status_code == 200
        long_name = await client.get(_ROUTE, params={"q": "a" * 39 + "/" + "b" * 100})
        assert long_name.status_code == 200

    assert len(requests) == 3
    assert requests[1].url.params["q"] == '"go" in:name is:public fork:true'
    request = requests[0]
    assert request.url.host == "api.github.com"
    assert request.url.path == "/search/repositories"
    assert request.url.params["q"] == 'user:pallets "flask" in:name is:public fork:true'
    assert request.url.params["per_page"] == "12"
    assert "Authorization" not in request.headers


@pytest.mark.anyio
async def test_search_handles_provider_errors_without_leaking_details(
    search_api: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, _ = search_api
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    ) as client:
        limited = await client.get(_ROUTE, params={"q": "limited"})
        assert limited.status_code == 429
        assert limited.json()["code"] == "github_search_rate_limited"
        unavailable = await client.get(_ROUTE, params={"q": "outage"})
        assert unavailable.status_code == 502
        assert unavailable.json()["code"] == "github_search_unavailable"
        assert "raw upstream error" not in unavailable.text


@pytest.mark.anyio
async def test_search_requires_a_session_in_public_mode() -> None:
    app = create_app(
        Settings(
            environment="test",
            access_mode="public_authenticated",
            public_origin="https://surgeon.example",
            github_oauth_client_id="fixture",
            github_oauth_client_secret="fixture",
            auth_encryption_key="fixture",
            cookie_secure=True,
            local_repository_access=False,
        )
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://surgeon.example"
        ) as client,
    ):
        response = await client.get(_ROUTE, params={"q": "flask"})
        assert response.status_code == 401
        assert response.json()["code"] == "authentication_required"


@pytest.mark.anyio
async def test_owner_prefixes_become_scoped_name_search(
    search_api: tuple[FastAPI, list[httpx.Request]],
) -> None:
    app, requests = search_api
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    ) as client:
        assert (await client.get(_ROUTE, params={"q": "tudstk/"})).status_code == 200
        assert (await client.get(_ROUTE, params={"q": "tudstk/repo"})).status_code == 200
    assert requests[0].url.params["q"] == "user:tudstk is:public fork:true"
    assert requests[1].url.params["q"] == 'user:tudstk "repo" in:name is:public fork:true'
