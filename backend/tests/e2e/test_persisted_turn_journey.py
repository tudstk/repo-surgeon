"""End-to-end tenant session, persisted turn, and SSE resume journey."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import UUID, uuid4

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import event, func, select

from repo_surgeon.application.authentication import IssuedSession, SessionService
from repo_surgeon.domain.authentication import UserStatus
from repo_surgeon.infrastructure.authentication_store import SqlAlchemySessionStore
from repo_surgeon.infrastructure.repository_models import RepositoryRecord, UserRecord
from repo_surgeon.infrastructure.run_models import (
    AgentRunRecord,
    ConversationSessionRecord,
    RunEventRecord,
    ToolCallRecord,
)
from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


@dataclass(frozen=True, slots=True)
class AuthenticatedApp:
    app: FastAPI
    issued: IssuedSession
    owner_id: UUID
    repository_id: UUID
    repository_root: Path


def _public_settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        environment="test",
        access_mode="public_authenticated",
        public_origin="https://surgeon.example",
        github_oauth_client_id="test-client-id",
        github_oauth_client_secret="test-client-secret",
        auth_encryption_key="test-encryption-key",
        cookie_secure=True,
        local_repository_access=False,
    )


async def _upgrade(database_url: str) -> None:
    configuration = Config(str(Path(__file__).parents[2] / "alembic.ini"))
    configuration.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, configuration, "head")


def _run_git(root: Path, *arguments: str) -> str:
    environment = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_OPTIONAL_LOCKS": "0"}
    completed = subprocess.run(
        ["git", "--no-optional-locks", "-C", str(root), *arguments],
        check=True,
        capture_output=True,
        env=environment,
        text=True,
        timeout=5,
    )
    return completed.stdout


def _create_git_repository(root: Path) -> None:
    root.mkdir()
    (root / "README.md").write_text("# Fixture\n\nA deterministic read-only repository.\n")
    (root / "src").mkdir()
    (root / "src" / "main.py").write_text('MESSAGE = "unchanged"\n')
    _run_git(root, "init", "--initial-branch=main")
    _run_git(root, "config", "user.name", "Repo Surgeon Tests")
    _run_git(root, "config", "user.email", "repo-surgeon@example.invalid")
    _run_git(root, "add", "README.md", "src/main.py")
    _run_git(root, "commit", "-m", "fixture")


def _repository_bytes_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda candidate: candidate.as_posix()):
        relative = path.relative_to(root).as_posix().encode()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        if path.is_symlink():
            digest.update(b"L")
            digest.update(os.readlink(path).encode())
        elif path.is_file():
            digest.update(b"F")
            digest.update(path.read_bytes())
        elif path.is_dir():
            digest.update(b"D")
    return digest.hexdigest()


def _repository_snapshot(root: Path) -> tuple[str, str, str]:
    return (
        _repository_bytes_digest(root),
        _run_git(root, "rev-parse", "HEAD").strip(),
        _run_git(root, "status", "--porcelain=v2", "--untracked-files=all"),
    )


@pytest.fixture
async def authenticated_app(tmp_path: Path) -> AsyncIterator[AuthenticatedApp]:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'turns.sqlite3'}"
    await _upgrade(database_url)
    app = create_app(_public_settings(database_url))

    @event.listens_for(app.state.engine.sync_engine, "connect")
    def enforce_sqlite_foreign_keys(dbapi_connection: Any, _: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    repository_root = tmp_path / "owned-repository"
    _create_git_repository(repository_root)
    root_stat = repository_root.stat()
    owner_id = uuid4()
    repository_id = uuid4()
    now = datetime.now(UTC)
    async with app.state.session_factory() as database:
        database.add(
            UserRecord(
                id=owner_id,
                status=UserStatus.ACTIVE.value,
                display_name="Authenticated owner",
            )
        )
        await database.commit()
        database.add(
            RepositoryRecord(
                id=repository_id,
                owner_user_id=owner_id,
                source="local",
                canonical_root=str(repository_root),
                root_device=root_stat.st_dev,
                root_inode=root_stat.st_ino,
            )
        )
        await database.commit()
        issued = await SessionService(
            SqlAlchemySessionStore(database),
            idle_ttl=timedelta(hours=1),
            absolute_ttl=timedelta(hours=8),
            csrf_secret=b"test-encryption-key",
        ).issue(owner_id, now)
    try:
        yield AuthenticatedApp(app, issued, owner_id, repository_id, repository_root)
    finally:
        await app.state.engine.dispose()


def _auth_headers(fixture: AuthenticatedApp, *, csrf: bool = False) -> dict[str, str]:
    headers = {
        "Cookie": (
            f"__Host-repo_surgeon_session={fixture.issued.session_token.reveal_for_transport()}"
        )
    }
    if csrf:
        headers.update(
            {
                "Origin": "https://surgeon.example",
                "X-CSRF-Token": fixture.issued.csrf_token.reveal_for_transport(),
            }
        )
    return headers


def _sse_events(response: httpx.Response) -> list[dict[str, object]]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


@pytest.mark.anyio
async def test_authenticated_owner_can_run_and_resume_one_read_only_turn(
    authenticated_app: AuthenticatedApp,
) -> None:
    fixture = authenticated_app
    before = _repository_snapshot(fixture.repository_root)
    transport = httpx.ASGITransport(app=fixture.app)
    async with httpx.AsyncClient(transport=transport, base_url="https://surgeon.example") as client:
        repositories = await client.get("/api/v1/repositories", headers=_auth_headers(fixture))
        assert repositories.status_code == 200
        assert repositories.headers["cache-control"] == "no-store"
        assert repositories.json() == [
            {"id": str(fixture.repository_id), "name": "owned-repository"}
        ]
        assert str(fixture.repository_root) not in repositories.text

        created_session = await client.post(
            "/api/v1/sessions",
            headers=_auth_headers(fixture, csrf=True),
            json={"repository_id": str(fixture.repository_id), "title": "Read-only review"},
        )
        assert created_session.status_code == 201
        product_session_id = created_session.json()["id"]

        turn = await client.post(
            f"/api/v1/sessions/{product_session_id}/turns",
            headers=_auth_headers(fixture, csrf=True),
            json={"message": "Please inspect token=raw-secret password=hunter2"},
        )
        assert turn.status_code == 201
        run_id = turn.json()["run_id"]
        assert turn.json()["status"] == "completed"

        persisted_session = await client.get(
            f"/api/v1/sessions/{product_session_id}", headers=_auth_headers(fixture)
        )
        assert persisted_session.status_code == 200
        assert persisted_session.json()["turns"] == [
            {
                "run_id": run_id,
                "status": "completed",
                "question": "Please inspect token=[REDACTED] password=[REDACTED]",
                "answer": "I completed a bounded read-only inspection of the selected repository.",
                "started_at": turn.json()["started_at"],
                "completed_at": turn.json()["completed_at"],
            }
        ]

        first_stream = await client.get(
            f"/api/v1/agent-runs/{run_id}/events", headers=_auth_headers(fixture)
        )
        assert first_stream.status_code == 200
        assert first_stream.headers["content-type"].startswith("text/event-stream")
        events = _sse_events(first_stream)
        assert "raw-secret" not in first_stream.text
        assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
        assert [event["type"] for event in events] == [
            "run.started",
            "progress.updated",
            "tool.requested",
            "tool.started",
            "tool.completed",
            "answer.completed",
            "run.completed",
        ]
        assert all(event["run_id"] == run_id for event in events)

        resume_after = events[3]
        resumed_stream = await client.get(
            f"/api/v1/agent-runs/{run_id}/events",
            headers={**_auth_headers(fixture), "Last-Event-ID": str(resume_after["event_id"])},
        )
        resumed = _sse_events(resumed_stream)
        assert [event["sequence"] for event in resumed] == [5, 6, 7]
        assert {event["event_id"] for event in resumed}.isdisjoint(
            {event["event_id"] for event in events[:4]}
        )

    after = _repository_snapshot(fixture.repository_root)
    assert after == before

    async with fixture.app.state.session_factory() as database:
        assert (
            await database.scalar(select(func.count()).select_from(ConversationSessionRecord)) == 1
        )
        assert await database.scalar(select(func.count()).select_from(AgentRunRecord)) == 1
        assert await database.scalar(select(func.count()).select_from(ToolCallRecord)) == 1
        assert await database.scalar(select(func.count()).select_from(RunEventRecord)) == 7
        run = (await database.execute(select(AgentRunRecord))).scalar_one()
        assert run.question == "Please inspect token=[REDACTED] password=[REDACTED]"
        assert "raw-secret" not in json.dumps({"question": run.question, "answer": run.answer})
        tool_call = (await database.execute(select(ToolCallRecord))).scalar_one()
        assert tool_call.validated_arguments == {"directory": ".", "max_results": 50}
        assert tool_call.provider_call_id != "token=raw-secret"
        UUID(tool_call.provider_call_id)
        assert str(fixture.repository_root) not in json.dumps(tool_call.result_summary)


@pytest.mark.anyio
async def test_public_post_requires_exact_origin_and_session_csrf(
    authenticated_app: AuthenticatedApp,
) -> None:
    fixture = authenticated_app
    transport = httpx.ASGITransport(app=fixture.app)
    attempts = [
        _auth_headers(fixture),
        {
            **_auth_headers(fixture, csrf=True),
            "Origin": "https://attacker.example",
        },
        {
            **_auth_headers(fixture, csrf=True),
            "X-CSRF-Token": "wrong-token",
        },
    ]
    async with httpx.AsyncClient(transport=transport, base_url="https://surgeon.example") as client:
        for headers in attempts:
            response = await client.post(
                "/api/v1/sessions",
                headers=headers,
                json={"repository_id": str(fixture.repository_id), "title": "Denied"},
            )
            assert response.status_code == 403
            assert response.json()["code"] == "request_forbidden"

        unauthenticated = await client.get("/api/v1/repositories")
        assert unauthenticated.status_code == 401
        assert unauthenticated.json()["code"] == "authentication_required"

    async with fixture.app.state.session_factory() as database:
        assert (
            await database.scalar(select(func.count()).select_from(ConversationSessionRecord)) == 0
        )


@pytest.mark.anyio
async def test_foreign_and_unknown_ids_have_indistinguishable_not_found_responses(
    authenticated_app: AuthenticatedApp,
) -> None:
    fixture = authenticated_app
    other_user_id = uuid4()
    other_repository_id = uuid4()
    other_session_id = uuid4()
    other_run_id = uuid4()
    now = datetime(2026, 9, 26, tzinfo=UTC)
    async with fixture.app.state.session_factory() as database:
        database.add(UserRecord(id=other_user_id, status="active", display_name="Other owner"))
        await database.commit()
        database.add(
            RepositoryRecord(
                id=other_repository_id,
                owner_user_id=other_user_id,
                source="local",
                canonical_root=str(fixture.repository_root),
                root_device=fixture.repository_root.stat().st_dev,
                root_inode=fixture.repository_root.stat().st_ino,
            )
        )
        await database.commit()
        database.add(
            ConversationSessionRecord(
                id=other_session_id,
                owner_user_id=other_user_id,
                repository_id=other_repository_id,
                title="Foreign session",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        await database.commit()
        database.add(
            AgentRunRecord(
                id=other_run_id,
                owner_user_id=other_user_id,
                session_id=other_session_id,
                correlation_id=uuid4(),
                status="completed",
                question="Foreign question",
                answer="Foreign answer",
                stop_reason=None,
                model_calls=1,
                tool_calls=0,
                returned_bytes=0,
                started_at=now,
                completed_at=now,
            )
        )
        await database.commit()

    transport = httpx.ASGITransport(app=fixture.app)
    async with httpx.AsyncClient(transport=transport, base_url="https://surgeon.example") as client:
        for path_template, foreign_id in (
            ("/api/v1/repositories/{}", other_repository_id),
            ("/api/v1/sessions/{}", other_session_id),
            ("/api/v1/agent-runs/{}/events", other_run_id),
        ):
            foreign = await client.get(
                path_template.format(foreign_id), headers=_auth_headers(fixture)
            )
            unknown = await client.get(
                path_template.format(uuid4()), headers=_auth_headers(fixture)
            )
            assert foreign.status_code == unknown.status_code == 404
            assert foreign.json() == unknown.json()

        for method, suffix, payload in [
            ("PATCH", "", {"title": "Renamed"}),
            ("POST", "/archive", {}),
        ]:
            foreign_mutation = await client.request(
                method,
                f"/api/v1/sessions/{other_session_id}{suffix}",
                headers=_auth_headers(fixture, csrf=True),
                json=payload,
            )
            unknown_mutation = await client.request(
                method,
                f"/api/v1/sessions/{uuid4()}{suffix}",
                headers=_auth_headers(fixture, csrf=True),
                json=payload,
            )
            assert foreign_mutation.status_code == unknown_mutation.status_code == 404
            assert foreign_mutation.json() == unknown_mutation.json()

        foreign_turn = await client.post(
            f"/api/v1/sessions/{other_session_id}/turns",
            headers=_auth_headers(fixture, csrf=True),
            json={"message": "Attempt foreign access"},
        )
        unknown_turn = await client.post(
            f"/api/v1/sessions/{uuid4()}/turns",
            headers=_auth_headers(fixture, csrf=True),
            json={"message": "Attempt unknown access"},
        )
        assert foreign_turn.status_code == unknown_turn.status_code == 404
        assert foreign_turn.json() == unknown_turn.json()


@pytest.mark.anyio
async def test_session_names_rename_and_removal_persist(
    authenticated_app: AuthenticatedApp,
) -> None:
    fixture = authenticated_app
    async with fixture.app.state.session_factory() as database:
        repository = await database.get(RepositoryRecord, fixture.repository_id)
        assert repository is not None
        repository.github_full_name = "owner/project"
        await database.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixture.app),
        base_url="https://surgeon.example",
        headers=_auth_headers(fixture, csrf=True),
    ) as client:
        body = {"repository_id": str(fixture.repository_id)}
        first = await client.post("/api/v1/sessions", json=body)
        assert first.status_code == 201
        second = await client.post("/api/v1/sessions", json=body)
        assert first.json()["title"] == "project read-only review"
        assert second.json()["title"] == "project read-only review-1"
        path = f"/api/v1/sessions/{first.json()['id']}"
        assert (await client.patch(path, json={"title": "  "})).status_code == 422
        assert (await client.patch(path, json={"title": second.json()["title"]})).status_code == 409
        for endpoint, method, payload in [
            (path, "PATCH", {"title": "Renamed"}),
            (path + "/archive", "POST", {}),
        ]:
            assert (
                await client.request(
                    method, endpoint, json=payload, headers={"X-CSRF-Token": "wrong"}
                )
            ).status_code == 403
        renamed = await client.patch(path, json={"title": "  Investigate tests  "})
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "Investigate tests"
        assert (await client.get(path)).json()["title"] == "Investigate tests"
        completed = await client.post(path + "/turns", json={"message": "List files"})
        assert completed.status_code == 201
        async with fixture.app.state.session_factory() as database:
            run = await database.get(AgentRunRecord, UUID(completed.json()["run_id"]))
            assert run is not None
            run.status = "running"
            await database.commit()
        assert (await client.post(path + "/archive")).status_code == 409
        async with fixture.app.state.session_factory() as database:
            run = await database.get(AgentRunRecord, UUID(completed.json()["run_id"]))
            assert run is not None
            run.status = "completed"
            await database.commit()
        assert (await client.post(path + "/archive")).status_code == 204
        listed = (await client.get("/api/v1/sessions", params=body)).json()
        assert [item["id"] for item in listed] == [second.json()["id"]]
        assert (await client.get(path)).status_code == 404
        assert (
            await client.post(path + "/turns", json={"message": "Inspect files"})
        ).status_code == 404
    async with fixture.app.state.session_factory() as database:
        retained = await database.get(ConversationSessionRecord, UUID(first.json()["id"]))
        assert retained is not None and retained.status == "archived"
        assert await database.get(AgentRunRecord, UUID(completed.json()["run_id"])) is not None


@pytest.mark.anyio
async def test_pr_review_stream_is_pinned_persisted_retry_safe_and_owner_scoped(
    authenticated_app: AuthenticatedApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
    from repo_surgeon.application.review_models import PullReviewSource
    from repo_surgeon.infrastructure.github_pull_requests import GitHubPullRequestFile

    fixture = authenticated_app
    fixture.app.state.settings = fixture.app.state.settings.model_copy(
        update={"review_mode": "simulation"}
    )
    async with fixture.app.state.session_factory() as database:
        record = await database.get(RepositoryRecord, fixture.repository_id)
        assert record is not None
        record.github_full_name = "sample/project"
        record.github_commit = "a" * 40
        await database.commit()
    root = fixture.repository_root
    (root / "src/main.py").write_text("def validate(value):\n    return value > 0\n")
    before = _repository_snapshot(root)
    calls = []

    async def review_source(repository: Any, number: int, destination: Path) -> PullReviewSource:
        calls.append((repository.id, number))
        destination.mkdir()
        (destination / "main.py").write_text("def validate(value):\n    return value > 1\n")
        info = destination.stat()
        return PullReviewSource(
            number,
            "Validate values",
            "Reject invalid values",
            "a" * 40,
            "b" * 40,
            (
                GitHubPullRequestFile(
                    "main.py",
                    None,
                    "modified",
                    1,
                    1,
                    "@@ -1,2 +1,2 @@\n def validate(value):\n"
                    "-    return value > 0\n+    return value > 1",
                    "available",
                ),
            ),
            0,
            ResolvedLocalRepositoryRoot(str(destination), info.st_dev, info.st_ino),
        )

    monkeypatch.setattr(fixture.app.state.github_importer, "review_source", review_source)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixture.app), base_url="https://surgeon.example"
    ) as client:
        headers = _auth_headers(fixture, csrf=True)
        session = await client.post(
            "/api/v1/sessions",
            headers=headers,
            json={"repository_id": str(fixture.repository_id), "title": "Review test"},
        )
        session_id = session.json()["id"]
        url = f"/api/v1/sessions/{session_id}/pull-request-reviews"
        request = {"number": 24, "request_id": str(uuid4())}
        missing_csrf = await client.post(url, headers=_auth_headers(fixture), json=request)
        assert missing_csrf.status_code == 403
        missing_owner = await client.post(
            f"/api/v1/sessions/{uuid4()}/pull-request-reviews", headers=headers, json=request
        )
        assert missing_owner.status_code == 404
        provider = await client.get("/api/v1/review-provider", headers=headers)
        assert provider.json()["simulation"] is True
        assert [m["id"] for m in provider.json()["models"]] == [
            "deepseek/deepseek-v3.2",
            "deepseek/deepseek-v4-flash",
        ]
        rejected = await client.post(
            url, headers=headers, json={**request, "model": "unapproved/expensive"}
        )
        assert rejected.status_code == 422
        assert calls == []
        assert provider.headers["cache-control"] == "no-store"
        response = await client.post(url, headers=headers, json=request)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store, no-transform"
        assert "event: delta" in response.text
        frames = _sse_events(response)
        result = frames[-1]
        assert result["question"] == "Code Review this PR"
        assert result["status"] == "completed"
        assert "No model has evaluated" in str(result["answer"])
        review = cast(dict[str, Any], result["review"])
        assert review["head_sha"] == "b" * 40
        assert review["title"] == "Validate values"
        assert review["simulation"] is True
        run_id = UUID(str(result["run_id"]))
        replay = await client.post(url, headers=headers, json=request)
        assert "event: completed" in replay.text
        assert "event: delta" not in replay.text
        assert len(calls) == 1
        changed_model = await client.post(
            url, headers=headers, json={**request, "model": "deepseek/deepseek-v4-flash"}
        )
        assert changed_model.status_code == 409
        conflict = await client.post(url, headers=headers, json={**request, "number": 25})
        assert conflict.status_code == 409
        detail = await client.get(f"/api/v1/sessions/{session_id}", headers=headers)
        assert detail.json()["turns"] == [result]
        events = await client.get(f"/api/v1/agent-runs/{run_id}/events", headers=headers)
        assert "repository_map" in events.text
        assert "run.completed" in events.text
        async with fixture.app.state.session_factory() as database:
            saved = await database.get(AgentRunRecord, run_id)
            assert saved is not None and saved.model_calls == 0
            assert saved.review_context is not None
            assert saved.review_context["excerpt_count"] == 1
        fixture.app.state.settings = fixture.app.state.settings.model_copy(
            update={"review_mode": "openrouter"}
        )
        unavailable = await client.post(
            url, headers=headers, json={**request, "request_id": str(uuid4())}
        )
        assert unavailable.status_code == 503
    assert _repository_snapshot(root) == before


@pytest.mark.anyio
async def test_failed_review_keeps_partial_answer_and_redacts_split_secrets(
    authenticated_app: AuthenticatedApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
    from repo_surgeon.application.review_models import PullReviewSource
    from repo_surgeon.infrastructure.openrouter_review import ReviewProviderError

    fixture = authenticated_app
    fixture.app.state.settings = fixture.app.state.settings.model_copy(
        update={"review_mode": "simulation"}
    )
    async with fixture.app.state.session_factory() as database:
        record = await database.get(RepositoryRecord, fixture.repository_id)
        assert record is not None
        record.github_full_name, record.github_commit = "sample/project", "a" * 40
        await database.commit()

    async def review_source(repository: Any, number: int, destination: Path) -> PullReviewSource:
        destination.mkdir()
        info = destination.stat()
        return PullReviewSource(
            number,
            "Review",
            "",
            "a" * 40,
            "b" * 40,
            (),
            0,
            ResolvedLocalRepositoryRoot(str(destination), info.st_dev, info.st_ino),
        )

    class Failure:
        async def stream(self, context: Any) -> AsyncIterator[str]:
            yield "## Partial answer\npassword=hunt"
            yield "er2\n"
            raise ReviewProviderError("The model provider disconnected.")

    monkeypatch.setattr(fixture.app.state.github_importer, "review_source", review_source)
    fixture.app.state.review_provider_factory = Failure
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixture.app), base_url="https://surgeon.example"
    ) as client:
        headers = _auth_headers(fixture, csrf=True)
        created = await client.post(
            "/api/v1/sessions", headers=headers, json={"repository_id": str(fixture.repository_id)}
        )
        url = f"/api/v1/sessions/{created.json()['id']}"
        response = await client.post(
            url + "/pull-request-reviews",
            headers=headers,
            json={"number": 24, "request_id": str(uuid4())},
        )
        assert "hunter2" not in response.text
        assert "event: failed" in response.text
        persisted = (await client.get(url, headers=headers)).json()["turns"][0]
        assert persisted["status"] == "failed"
        assert persisted["answer"] == "## Partial answer\npassword=[REDACTED]\n"
        assert persisted["review"]["error"] == "The model provider disconnected."


@pytest.mark.anyio
async def test_repository_chat_answers_and_followups_are_bounded_owned_and_replay_safe(
    authenticated_app: AuthenticatedApp,
) -> None:
    from repo_surgeon.application.review_context import ReviewContext

    fixture = authenticated_app
    fixture.app.state.settings = fixture.app.state.settings.model_copy(
        update={"review_mode": "simulation"}
    )
    packets: list[dict[str, Any]] = []

    class Provider:
        async def stream(self, context: ReviewContext) -> AsyncIterator[str]:
            packets.append(json.loads(context.text))
            yield "The entry point is `src/main.py`.\n"

    fixture.app.state.review_provider_factory = Provider
    before = _repository_snapshot(fixture.repository_root)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixture.app), base_url="https://surgeon.example"
    ) as client:
        headers = _auth_headers(fixture, csrf=True)
        created = await client.post(
            "/api/v1/sessions", headers=headers, json={"repository_id": str(fixture.repository_id)}
        )
        sid = created.json()["id"]
        url = f"/api/v1/sessions/{sid}/repository-messages"
        body = {
            "message": "Explain the main entry point",
            "request_id": str(uuid4()),
            "model": "deepseek/deepseek-v4-flash",
        }
        assert (
            await client.post(url, headers=_auth_headers(fixture), json=body)
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/sessions/{uuid4()}/repository-messages", headers=headers, json=body
            )
        ).status_code == 404
        assert (
            await client.post(url, headers=headers, json={**body, "model": "unapproved/model"})
        ).status_code == 422
        first = await client.post(url, headers=headers, json=body)
        assert first.status_code == 200
        result = _sse_events(first)[-1]
        assert result["status"] == "completed"
        assert result["question"] == body["message"]
        assert cast(dict[str, Any], result["review"])["kind"] == "repository_chat"
        assert "pull_request" not in packets[0]
        assert packets[0]["question"] == body["message"]
        assert packets[0]["excerpts"]
        assert packets[0]["recent_conversation"] == []
        assert (await client.post(url, headers=headers, json=body)).status_code == 200
        assert len(packets) == 1
        assert (
            await client.post(
                url, headers=headers, json={**body, "message": "A different question"}
            )
        ).status_code == 409
        second = await client.post(
            url,
            headers=headers,
            json={**body, "request_id": str(uuid4()), "message": "Explain more"},
        )
        assert _sse_events(second)[-1]["status"] == "completed"
        assert packets[1]["recent_conversation"] == [
            {"question": body["message"], "answer": result["answer"]}
        ]
        restored = (await client.get(f"/api/v1/sessions/{sid}", headers=headers)).json()
        assert restored["turns"][-1]["question"] == "Explain more"
    assert _repository_snapshot(fixture.repository_root) == before
