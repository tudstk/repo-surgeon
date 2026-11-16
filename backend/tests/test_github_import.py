"""Exercise imported public snapshots through the authenticated HTTP boundary."""

import io
import zipfile
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from alembic import command
from alembic.config import Config

from repo_surgeon.infrastructure.github_import import (
    GitHubImporter,
    GitHubImportError,
    extract_snapshot,
)
from repo_surgeon.infrastructure.repository_models import RepositoryRecord
from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


def archive(name: str = "repo/src/main.py", content: str = "print('hello')") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as zipped:
        zipped.writestr(name, content)
    return output.getvalue()


@pytest.mark.parametrize(
    "name", ["repo/../escape", "/repo/file", "repo/.git/config", "repo/.GIT/config", "repo/a\\b"]
)
def test_archive_cannot_escape_or_write_git_internals(tmp_path: Path, name: str) -> None:
    with pytest.raises(GitHubImportError):
        extract_snapshot(archive(name), tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_symlinks_are_rejected_before_any_file_is_written(tmp_path: Path) -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as zipped:
        zipped.writestr("repo/README.md", "safe")
        link = zipfile.ZipInfo("repo/link")
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        zipped.writestr(link, "/etc/passwd")
    with pytest.raises(GitHubImportError):
        extract_snapshot(output.getvalue(), tmp_path)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.anyio
async def test_import_persists_and_supports_summary_and_retry(tmp_path: Path) -> None:
    import asyncio

    database_url = f"sqlite+aiosqlite:///{tmp_path / 'import.sqlite'}"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, config, "head")
    settings = Settings(
        environment="test", database_url=database_url, repository_storage=tmp_path / "storage"
    )
    app = create_app(settings)
    sha = "a" * 40
    latest = sha
    repository_id_on_github = 42
    fail_new_archive = False
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert "Authorization" not in request.headers
        if request.url.host == "codeload.github.com":
            if request.url.path == f"/owner/project/zip/{sha}":
                return httpx.Response(200, content=archive())
            assert request.url.path == f"/owner/project/zip/{latest}"
            return httpx.Response(
                200, content=b"not a zip" if fail_new_archive else archive(content="print('new')")
            )
        if request.url.path.endswith("/commits"):
            return httpx.Response(200, json=[{"sha": latest}])
        return httpx.Response(
            200,
            json={
                "id": repository_id_on_github,
                "full_name": "owner/project",
                "private": False,
                "visibility": "public",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as github:
        app.state.github_importer = GitHubImporter(settings.repository_storage, client=github)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
            ) as client,
        ):
            response = await client.post(
                "/api/v1/repositories/github/import", json={"full_name": "owner/project"}
            )
            assert response.status_code == 200, response.text
            repository = response.json()
            assert repository["name"] == "owner/project"
            summary = await client.get(f"/api/v1/repositories/{repository['id']}/summary")
            assert summary.status_code == 200
            assert summary.json()["file_count"] == 1
            again = await client.post(
                "/api/v1/repositories/github/import", json={"full_name": "owner/project"}
            )
            assert again.json() == repository
            listed = await client.get("/api/v1/repositories")
            assert listed.json() == [repository]
            session = await client.post(
                "/api/v1/sessions",
                json={"repository_id": repository["id"], "title": "Imported review"},
            )
            assert session.status_code == 201, session.text
            session_id = session.json()["id"]
            turn = await client.post(
                f"/api/v1/sessions/{session_id}/turns", json={"message": "List the source files"}
            )
            assert turn.status_code == 201, turn.text
            assert turn.json()["status"] == "completed"
            restored = await client.get(f"/api/v1/sessions/{session_id}")
            assert restored.json()["turns"][0]["run_id"] == turn.json()["run_id"]
            repository_url = f"/api/v1/repositories/{repository['id']}"
            async with app.state.session_factory() as database:
                row = await database.get(RepositoryRecord, UUID(repository["id"]))
                assert row is not None and row.root_device is not None
                root = Path(row.canonical_root)
                row.root_device += 1
                await database.commit()
            assert (await client.get(repository_url + "/summary")).status_code == 503
            original = root / "src/main.py"
            original.write_text("changed")
            assert (await client.post(repository_url + "/recover")).status_code == 422
            assert (await client.get(repository_url + "/summary")).status_code == 503
            outside = tmp_path / "outside.py"
            outside.write_text("print('hello')")
            original.unlink()
            original.symlink_to(outside)
            assert (await client.post(repository_url + "/recover")).status_code == 422
            assert (await client.get(repository_url + "/summary")).status_code == 503
            original.unlink()
            original.write_text("print('hello')")
            recovered = await client.post(repository_url + "/recover")
            assert recovered.status_code == 204, recovered.text
            assert (await client.get(repository_url + "/summary")).status_code == 200
            assert (await client.get(f"/api/v1/sessions/{session_id}")).json() == restored.json()
            visibility = f"/api/v1/repositories/{repository['id']}/visibility"
            assert (await client.post(visibility, json={"hidden": True})).status_code == 204
            assert (await client.get("/api/v1/repositories")).json() == []
            assert (await client.get(f"/api/v1/sessions/{session_id}")).status_code == 200
            reimported = await client.post(
                "/api/v1/repositories/github/import", json={"full_name": "owner/project"}
            )
            assert reimported.json() == repository
            (root / ".env").write_text("private-value")
            (root / "secret-folder").mkdir()
            (root / "secret-folder" / "inside.py").write_text("private-value")
            (root / "empty").mkdir()
            (root / "linked").symlink_to(tmp_path, target_is_directory=True)
            (root / "src" / "binary.png").write_bytes(b"\x00")
            (root / "src" / "local.key").write_text("private-value")
            (root / "src" / "key-material.txt").write_text(
                "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-value"
            )
            (root / "src" / "unicode.md").write_text("# Unicode", encoding="utf-16")
            (root / "src" / "long.txt").write_text("line\n" * 501)
            (root / "src" / "large.txt").write_bytes(b"a" * (64 * 1024 + 1))
            tree = await client.get(repository_url + "/tree")
            assert tree.headers["cache-control"] == "no-store"
            assert [(entry["name"], entry["kind"]) for entry in tree.json()["entries"]] == [
                ("empty", "directory"),
                ("src", "directory"),
            ]
            children = await client.get(repository_url + "/tree", params={"directory": "src"})
            assert children.json()["entries"][0]["path"] == "src/binary.png"
            preview = await client.get(repository_url + "/file", params={"path": "src/main.py"})
            assert preview.headers["cache-control"] == "no-store"
            assert preview.json() == {
                "path": "src/main.py",
                "start_line": 1,
                "end_line": 1,
                "has_more": False,
                "lines": ["print('hello')"],
            }
            unicode_preview = await client.get(
                repository_url + "/file", params={"path": "src/unicode.md"}
            )
            assert unicode_preview.json()["lines"] == ["# Unicode"]
            long = await client.get(repository_url + "/file", params={"path": "src/long.txt"})
            assert len(long.json()["lines"]) == 500 and long.json()["has_more"]
            last = await client.get(
                repository_url + "/file",
                params={"path": "src/long.txt", "start_line": 501},
            )
            assert last.json()["lines"] == ["line"] and not last.json()["has_more"]
            for path, status in [
                (".env", 404),
                ("../outside.py", 404),
                ("secret-folder/inside.py", 404),
                ("linked/outside.py", 404),
                ("src/local.key", 404),
                ("src/key-material.txt", 404),
                ("src/large.txt", 413),
                ("src/binary.png", 415),
            ]:
                refused = await client.get(repository_url + "/file", params={"path": path})
                assert refused.status_code == status
                assert "private-value" not in refused.text
            refused = await client.get(repository_url + "/tree", params={"directory": "linked"})
            assert refused.status_code == 404
            assert (await client.get("/api/v1/repositories")).json() == [repository]
            assert (await client.post(visibility, json={"hidden": True})).status_code == 204
            assert (await client.post(visibility, json={"hidden": False})).status_code == 204
            assert (await client.get("/api/v1/repositories")).json() == [repository]
            assert len(requests) == 15
            status_url = repository_url + "/sync-status"
            sync_url = repository_url + "/sync"
            before = len(requests)
            current = await client.get(status_url)
            assert current.headers["cache-control"] == "no-store"
            assert current.json() == {"up_to_date": True}
            assert (await client.post(sync_url)).json() == repository
            assert all(item.url.host == "api.github.com" for item in requests[before:])

            latest = "b" * 40
            assert (await client.get(status_url)).json() == {"up_to_date": False}
            repository_id_on_github = 43
            before = len(requests)
            assert (await client.get(status_url)).status_code == 502
            assert (await client.post(sync_url)).status_code == 422
            assert len(requests) == before + 2  # Stop at metadata when the repository ID changed.
            repository_id_on_github = 42

            fail_new_archive = True
            assert (await client.post(sync_url)).status_code == 422
            assert (await client.get("/api/v1/repositories")).json() == [repository]
            fail_new_archive = False
            synced = await client.post(sync_url)
            assert synced.status_code == 200, synced.text
            snapshot = synced.json()
            assert snapshot["id"] == repository["id"]
            assert snapshot["github_commit"] == latest
            assert (await client.post(sync_url)).json() == snapshot
            assert (await client.get("/api/v1/repositories")).json() == [snapshot]
            refreshed = f"/api/v1/repositories/{snapshot['id']}"
            assert (await client.get(refreshed + "/sync-status")).json() == {"up_to_date": True}
            fresh = await client.get(refreshed + "/file", params={"path": "src/main.py"})
            assert fresh.json()["lines"] == ["print('new')"]
            assert (root / "src/main.py").read_text() == "print('hello')"
            assert (await client.get(f"/api/v1/sessions/{session_id}")).json() == restored.json()
            latest = "c" * 40
            legacy = await client.post(
                "/api/v1/repositories/github/import", json={"full_name": "owner/project"}
            )
            assert legacy.status_code == 200
            duplicate = legacy.json()
            duplicated_session = await client.post(
                "/api/v1/sessions",
                json={"repository_id": duplicate["id"], "title": "Previously synced"},
            )
            assert duplicated_session.status_code == 201
            assert len((await client.get("/api/v1/repositories")).json()) == 2
            consolidated = await client.post(sync_url)
            assert consolidated.status_code == 200, consolidated.text
            assert consolidated.json() == {**repository, "github_commit": latest}
            assert (await client.get("/api/v1/repositories")).json() == [consolidated.json()]
            session_list = await client.get(
                "/api/v1/sessions", params={"repository_id": repository["id"]}
            )
            assert {item["id"] for item in session_list.json()} == {
                session_id,
                duplicated_session.json()["id"],
            }
            assert (root.parent / ("b" * 40) / "src/main.py").is_file()
    assert not list(settings.repository_storage.rglob(".import-*"))


@pytest.mark.anyio
async def test_private_repository_is_rejected_without_downloading(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": 42, "full_name": "owner/private", "private": True})

    from uuid import uuid4

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        importer = GitHubImporter(tmp_path, client=client)
        with pytest.raises(GitHubImportError):
            await importer.import_public("owner/private", uuid4())
    assert len(requests) == 1
    assert list(tmp_path.iterdir()) == []


@pytest.mark.anyio
async def test_public_import_requires_csrf_and_isolates_accounts(tmp_path: Path) -> None:
    import asyncio
    from datetime import UTC, datetime, timedelta

    from repo_surgeon.application.authentication import (
        GitHubProfile,
        SessionService,
        SynchronizeGitHubIdentity,
    )
    from repo_surgeon.infrastructure.authentication_store import (
        SqlAlchemySessionStore,
        SqlAlchemyUserIdentityStore,
    )

    database_url = f"sqlite+aiosqlite:///{tmp_path / 'public-import.sqlite'}"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, config, "head")
    settings = Settings(
        environment="test",
        database_url=database_url,
        repository_storage=tmp_path / "storage",
        access_mode="public_authenticated",
        public_origin="https://surgeon.example",
        github_oauth_client_id="fixture",
        github_oauth_client_secret="fixture",
        auth_encryption_key="fixture",
        cookie_secure=True,
        local_repository_access=False,
    )
    app = create_app(settings)
    credentials: list[tuple[str, str]] = []
    for subject in (101, 102):
        async with app.state.session_factory() as database:
            user, _ = await SynchronizeGitHubIdentity(
                SqlAlchemyUserIdentityStore(database)
            ).execute(
                GitHubProfile(subject, f"U_{subject}", f"user{subject}", "Test user", None, None)
            )
            issued = await SessionService(
                SqlAlchemySessionStore(database),
                idle_ttl=timedelta(hours=1),
                absolute_ttl=timedelta(hours=2),
                csrf_secret=b"fixture",
            ).issue(user.id, datetime.now(UTC))
            credentials.append(
                (
                    issued.session_token.reveal_for_transport(),
                    issued.csrf_token.reveal_for_transport(),
                )
            )

    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.host == "codeload.github.com":
            return httpx.Response(200, content=archive())
        if request.url.path.endswith("/commits"):
            return httpx.Response(200, json=[{"sha": "a" * 40}])
        return httpx.Response(
            200,
            json={"id": 42, "full_name": "owner/project", "private": False, "visibility": "public"},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as github:
        app.state.github_importer = GitHubImporter(settings.repository_storage, client=github)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url=settings.public_origin,
            ) as client,
        ):
            endpoint = "/api/v1/repositories/github/import"
            body = {"full_name": "owner/project"}
            assert (await client.post(endpoint, json=body)).status_code == 401
            token, csrf = credentials[0]
            client.cookies.set("__Host-repo_surgeon_session", token)
            for headers in (
                {},
                {"Origin": settings.public_origin, "X-CSRF-Token": "wrong"},
                {"Origin": "https://other.example", "X-CSRF-Token": csrf},
            ):
                assert (await client.post(endpoint, json=body, headers=headers)).status_code == 403
            assert not requests
            client.headers.update({"Origin": settings.public_origin, "X-CSRF-Token": csrf})
            first = await client.post(endpoint, json=body)
            assert first.status_code == 200, first.text
            first_id = first.json()["id"]
            forbidden = await client.post(
                f"/api/v1/repositories/{first_id}/visibility",
                json={"hidden": True},
                headers={"X-CSRF-Token": "wrong"},
            )
            assert forbidden.status_code == 403
            assert (
                await client.post(
                    f"/api/v1/repositories/{first_id}/recover", headers={"X-CSRF-Token": "wrong"}
                )
            ).status_code == 403
            bad_sync = await client.post(
                f"/api/v1/repositories/{first_id}/sync", headers={"X-CSRF-Token": "wrong"}
            )
            assert bad_sync.status_code == 403
            assert "canonical_root" not in first.text
            token, csrf = credentials[1]
            client.cookies.set("__Host-repo_surgeon_session", token)
            client.headers["X-CSRF-Token"] = csrf
            assert (await client.get("/api/v1/repositories")).json() == []
            assert (
                await client.post(
                    f"/api/v1/repositories/{first_id}/visibility", json={"hidden": True}
                )
            ).status_code == 404
            assert (
                await client.post(f"/api/v1/repositories/{first_id}/recover")
            ).status_code == 404
            assert (await client.get(f"/api/v1/repositories/{first_id}/summary")).status_code == 404
            assert (await client.get(f"/api/v1/repositories/{first_id}/tree")).status_code == 404
            foreign_file = await client.get(
                f"/api/v1/repositories/{first_id}/file", params={"path": "src/main.py"}
            )
            assert foreign_file.status_code == 404
            foreign_url = f"/api/v1/repositories/{first_id}"
            before = len(requests)
            assert (await client.get(foreign_url + "/sync-status")).status_code == 404
            assert (await client.post(foreign_url + "/sync")).status_code == 404
            assert len(requests) == before
            second = await client.post(endpoint, json=body)
            assert second.status_code == 200, second.text
            assert second.json()["id"] != first_id
            assert (await client.get("/api/v1/repositories")).json() == [second.json()]
    assert len(list(settings.repository_storage.glob("*/*/" + "a" * 40))) == 2


def test_archive_limits_and_case_collisions_fail_before_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import repo_surgeon.infrastructure.github_import as module

    monkeypatch.setattr(module, "MAX_SOURCE_BYTES", 8)
    with pytest.raises(GitHubImportError, match="size limit"):
        extract_snapshot(archive(content="123456789"), tmp_path)
    monkeypatch.setattr(module, "MAX_SOURCE_BYTES", 100)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as zipped:
        zipped.writestr("repo/Readme", "a")
        zipped.writestr("repo/README", "b")
    with pytest.raises(GitHubImportError, match="conflicting"):
        extract_snapshot(output.getvalue(), tmp_path)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.anyio
async def test_failed_download_never_publishes_a_repository(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from uuid import uuid4

    import repo_surgeon.infrastructure.github_import as module

    monkeypatch.setattr(module, "MAX_ARCHIVE_BYTES", 8)

    def upstream(request: httpx.Request) -> httpx.Response:
        if request.url.host == "codeload.github.com":
            return httpx.Response(200, content=b"123456789")
        if request.url.path.endswith("/commits"):
            return httpx.Response(200, json=[{"sha": "a" * 40}])
        return httpx.Response(
            200,
            json={"id": 42, "full_name": "owner/project", "private": False, "visibility": "public"},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        with pytest.raises(GitHubImportError, match="25 MiB"):
            await GitHubImporter(tmp_path, client=client).import_public("owner/project", uuid4())
    assert list(tmp_path.iterdir()) == []


@pytest.mark.anyio
async def test_concurrent_publication_converges_without_partial_files(tmp_path: Path) -> None:
    import asyncio
    from uuid import uuid4

    owner = uuid4()
    importer = GitHubImporter(tmp_path)
    try:
        first, second = await asyncio.gather(
            *[
                asyncio.to_thread(
                    importer._publish, archive(), owner, 42, "owner/project", "a" * 40
                )
                for _ in range(2)
            ]
        )
        assert first == second
        assert (Path(first.root.canonical_root) / "src/main.py").read_text() == "print('hello')"
        assert not list(tmp_path.rglob(".import-*"))
    finally:
        await importer.aclose()
