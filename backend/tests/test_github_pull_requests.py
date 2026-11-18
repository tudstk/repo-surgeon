"""Exercise bounded pull request reads through the workspace HTTP boundary."""

import asyncio
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from alembic import command
from alembic.config import Config
from test_github_import import archive

from repo_surgeon.infrastructure.github_import import GitHubImporter
from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


@pytest.mark.anyio
async def test_pull_request_browser_reads_owned_snapshot_and_filters_unsafe_diffs(
    tmp_path: Path,
) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'pull-requests.sqlite'}"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, config, "head")
    settings = Settings(
        environment="test", database_url=database_url, repository_storage=tmp_path / "storage"
    )
    app = create_app(settings)
    calls: list[str] = []
    pull = {
        "number": 32,
        "title": "Tighten query validation",
        "state": "closed",
        "merged_at": "2026-01-15T14:15:16Z",
        "updated_at": "2026-01-15T14:15:16Z",
        "user": {"login": "tester"},
        "base": {"ref": "main"},
        "head": {"ref": "fix-query"},
        "html_url": "https://unexpected.test/injected-link",
    }
    source_patch = "@@ -1 +1 @@\n-return value\n+return validate(value)"
    file = {
        "filename": "src/validation.py",
        "status": "modified",
        "additions": 1,
        "deletions": 1,
        "patch": source_patch,
    }

    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert "authorization" not in request.headers
        path = request.url.path
        calls.append(path)
        if request.url.host == "codeload.github.com":
            return httpx.Response(200, content=archive())
        assert request.url.host == "api.github.com"
        if path.endswith("/commits"):
            return httpx.Response(200, json=[{"sha": "a" * 40}])
        if path.endswith("/pulls"):
            assert request.url.params["state"] == "closed"
            assert request.url.params["per_page"] == "20"
            return httpx.Response(200, json=[pull])
        if path.endswith("/pulls/32"):
            return httpx.Response(
                200, json={**pull, "changed_files": 6, "additions": 2, "deletions": 3}
            )
        if path.endswith("/pulls/32/files"):
            assert request.url.params["per_page"] == "5"
            if request.url.params["page"] == "2":
                return httpx.Response(200, json=[{**file, "filename": "src/other.ts"}])
            return httpx.Response(
                200,
                json=[
                    file,
                    {**file, "filename": "../escape"},
                    {**file, "status": "renamed", "previous_filename": "config/.env"},
                    {
                        **file,
                        "filename": "src/protected.txt",
                        "patch": "+-----BEGIN PRIVATE KEY-----",
                    },
                    {**file, "filename": "src/large.txt", "patch": "+" * (100 * 1024)},
                ],
                headers={"Link": '<https://unexpected.test/never-follow>; rel="next"'},
            )
        if path.endswith("/pulls/99"):
            return httpx.Response(404)
        assert path == "/repos/owner/project"
        return httpx.Response(
            200,
            json={"id": 42, "full_name": "owner/project", "private": False, "visibility": "public"},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as github:
        app.state.github_importer = GitHubImporter(settings.repository_storage, client=github)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
            ) as client,
        ):
            imported = await client.post(
                "/api/v1/repositories/github/import", json={"full_name": "owner/project"}
            )
            before = len(calls)
            assert (
                await client.get(f"/api/v1/repositories/{uuid4()}/pull-requests")
            ).status_code == 404
            assert len(calls) == before
            url = f"/api/v1/repositories/{imported.json()['id']}/pull-requests"
            assert (await client.get(url, params={"state": "all"})).status_code == 422
            assert (await client.get(url + "/32/files", params={"page": 601})).status_code == 422
            listing = await client.get(url, params={"state": "closed"})
            assert listing.headers["cache-control"] == "no-store"
            assert listing.json()["pulls"][0]["status"] == "merged"
            assert listing.json()["pulls"][0]["url"] == "https://github.com/owner/project/pull/32"
            changes = await client.get(url + "/32/files")
            assert changes.headers["cache-control"] == "no-store"
            assert changes.json()["restricted_files"] == 2
            assert changes.json()["next_page"] == 2
            assert [entry["patch_status"] for entry in changes.json()["files"]] == [
                "available",
                "restricted",
                "limited",
            ]
            assert changes.json()["files"][0]["patch"] == source_patch
            assert ".env" not in changes.text
            assert "PRIVATE KEY" not in changes.text
            next_page = await client.get(url + "/32/files", params={"page": 2})
            assert next_page.json()["files"][0]["path"] == "src/other.ts"
            assert (
                (await client.get(url + "/99/files"))
                .json()["detail"]
                .startswith("GitHub could not find pull request #99")
            )


@pytest.mark.anyio
async def test_review_source_pins_head_filters_hidden_paths_and_rejects_a_changed_pr(
    tmp_path: Path,
) -> None:
    from datetime import UTC, datetime

    from repo_surgeon.application.review_context import build_review_context
    from repo_surgeon.domain.repositories import Repository, RepositorySource
    from repo_surgeon.infrastructure.github_import import GitHubImportError

    changed = False
    detail_reads = 0
    head = "b" * 40
    archived = []
    pull = {
        "number": 24,
        "title": "Validate prices",
        "body": "Reject invalid values",
        "state": "open",
        "updated_at": "2026-11-18T12:00:00Z",
        "user": {"login": "ada"},
        "base": {"ref": "main", "sha": "a" * 40},
        "head": {"ref": "fix-validation", "sha": head},
        "changed_files": 2,
    }

    def upstream(request: httpx.Request) -> httpx.Response:
        nonlocal detail_reads
        assert request.method == "GET"
        assert "authorization" not in request.headers
        path = request.url.path
        if request.url.host == "codeload.github.com":
            archived.append(path)
            assert path.endswith(head)
            return httpx.Response(
                200, content=archive("repo/main.py", "def valid(n): return n > 0")
            )
        if path.endswith("/pulls/24/files"):
            assert request.url.params["per_page"] == "10"
            return httpx.Response(
                200,
                json=[
                    {
                        "filename": "main.py",
                        "status": "modified",
                        "additions": 1,
                        "deletions": 1,
                        "patch": "@@ -1 +1 @@\n-old\n+new",
                    },
                    {
                        "filename": ".env",
                        "status": "modified",
                        "additions": 1,
                        "deletions": 1,
                        "patch": "+SECRET",
                    },
                ],
            )
        if path.endswith("/pulls/24"):
            detail_reads += 1
            return httpx.Response(
                200,
                json={**pull, "head": {"ref": "fix-validation", "sha": "c" * 40}}
                if changed and detail_reads % 2 == 0
                else pull,
            )
        assert path == "/repos/owner/project"
        return httpx.Response(
            200,
            json={"id": 42, "full_name": "owner/project", "private": False, "visibility": "public"},
        )

    repository = Repository(
        uuid4(),
        RepositorySource.GITHUB,
        str(tmp_path / "storage" / "00000000-0000-0000-0000-000000000001" / "42" / ("a" * 40)),
        datetime.now(UTC),
        github_full_name="owner/project",
        github_commit="a" * 40,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        importer = GitHubImporter(tmp_path / "storage", client=client)
        source = await importer.review_source(repository, 24, tmp_path / "head")
        assert source.head_sha == head
        assert source.description == "Reject invalid values"
        assert source.omitted_files == 1
        context = build_review_context(source)
        assert "SECRET" not in context.text
        assert context.limited
        assert len(archived) == 1
        changed = True
        with pytest.raises(GitHubImportError, match="changed while loading"):
            await importer.review_source(repository, 24, tmp_path / "second")
        assert len(archived) == 1
