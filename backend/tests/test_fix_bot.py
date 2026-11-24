"""Exercise the publication boundary with real signed tokens and an in-memory GitHub."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from test_github_app import app_setup
from test_github_import import archive

from repo_surgeon.application.fix_suggestion import FixError
from repo_surgeon.fix_bot import FixBot
from repo_surgeon.infrastructure.github_app import GitHubAppInstallation
from repo_surgeon.settings import GitHubAppSettings

__all__ = ["app_setup"]


@pytest.mark.anyio
async def test_approved_fix_flow(
    app_setup: tuple[GitHubAppSettings, rsa.RSAPublicKey], monkeypatch: pytest.MonkeyPatch
) -> None:
    app = GitHubAppInstallation(app_setup[0])
    head = "a" * 40
    content = "count = 0\n"
    sha = hashlib.sha1(b"blob 10\0" + content.encode()).hexdigest()
    owner = 17
    comment_owner = owner
    approval = apply = branch = ""
    message = ""
    tested = 0
    fail_tests = False
    posts: list[str] = []
    minted: list[dict[str, str]] = []

    def sandbox(root: Path, image: str, test: str) -> None:
        nonlocal tested
        assert (root / "code.py").read_text() == "count = 1\n"
        tested += 1
        if fail_tests:
            raise FixError("test failed")

    monkeypatch.setattr("repo_surgeon.fix_bot.test_fix", sandbox)

    def upstream(req: httpx.Request) -> httpx.Response:
        nonlocal branch, message
        path = req.url.path
        base = "https://api.github.com/repos/owner/repo"
        if path.endswith("/access_tokens"):
            permissions = json.loads(req.content)["permissions"]
            minted.append(permissions)
            return httpx.Response(
                201,
                json={
                    "token": "-".join(next(iter(permissions.items()))),
                    "expires_at": (datetime.now(UTC) + timedelta(minutes=30)).isoformat(),
                    "permissions": permissions,
                },
            )
        if path.startswith("/owner/repo/legacy.zip/"):
            assert "Authorization" not in req.headers
            return httpx.Response(200, content=archive("project/code.py", content))
        if path == "/graphql":
            assert req.headers["authorization"] == "Bearer pull_requests-read"
            nodes = json.loads(req.content)["variables"]["i"]
            return httpx.Response(
                200,
                json={"data": {"nodes": [{"id": node, "lastEditedAt": None} for node in nodes]}},
            )
        if req.method == "POST":
            assert req.headers["authorization"] == "Bearer contents-write"
            posts.append(path)
            body = json.loads(req.content)
            if path.endswith("/trees"):
                assert body["tree"] == [
                    {"path": "code.py", "mode": "100644", "type": "blob", "content": "count = 1\n"}
                ]
            if path.endswith("/commits"):
                assert body["parents"] == [head]
                message = body["message"]
            if path.endswith("/refs"):
                assert body["ref"] == branch_name
                branch = body["sha"]
            return httpx.Response(201, json={"sha": "f" * 40})
        obj: dict[str, Any]
        if path == "/repositories/42":
            obj = {"id": 42, "owner": {"type": "User", "id": owner}, "full_name": "owner/repo"}
        elif path.endswith("/pulls/3"):
            obj = {
                "state": "open",
                "head": {"sha": head, "repo": {"id": 42}},
                "base": {"repo": {"id": 42}},
            }
        elif path.endswith("/pulls/comments/11"):
            obj = {
                "id": 11,
                "commit_id": "a" * 40,
                "side": "RIGHT",
                "line": 1,
                "path": "code.py",
                "body": "```suggestion\ncount = 1\n```",
                "pull_request_url": base + "/pulls/3",
            }
        elif path.endswith("/zipball/" + head):
            return httpx.Response(
                302,
                headers={"Location": "https://codeload.github.com/owner/repo/legacy.zip/" + head},
            )
        elif "/git/ref/" in path:
            if not branch:
                return httpx.Response(404)
            obj = {"object": {"sha": branch}}
        elif path.endswith("/git/commits/" + head):
            obj = {"tree": {"sha": "b" * 40}}
        elif path.endswith("/git/commits/" + "f" * 40):
            obj = {"tree": {"sha": "f" * 40}, "message": message, "parents": [{"sha": head}]}
        elif "/git/trees/" in path:
            obj = {
                "truncated": False,
                "tree": [{"path": "code.py", "type": "blob", "mode": "100644", "sha": sha}],
            }
        elif "/issues/comments/" in path:
            cid = int(path.rsplit("/", 1)[1])
            obj = {
                "id": cid,
                "node_id": str(cid),
                "user": {"type": "User", "id": comment_owner},
                "issue_url": base + "/issues/3",
                "created_at": "now",
                "updated_at": "now",
                "body": approval if cid == 21 else apply,
            }
        else:
            pytest.fail(path)
        return httpx.Response(200, json=obj)

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        bot = FixBot(client, app)
        image = "sha256:" + "d" * 64

        async def run(ids: tuple[int, int] | None = None) -> str:
            assert ids is not None
            return await bot.apply(3, 11, image, "test_code.py", ids)

        fix = await bot.preview(3, 11, image, "test_code.py")
        assert "+count = 1" in fix.preview_text
        approval = fix.preview_text.splitlines()[-1]
        apply = fix.apply_command(21)
        branch_name = "refs/heads/" + fix.branch
        assert not posts and {"contents": "write"} not in minted
        comment_owner = 18
        with pytest.raises(FixError, match="owner"):
            await run((21, 22))
        comment_owner = owner
        fail_tests = True
        with pytest.raises(FixError, match="test failed"):
            await run((21, 22))
        fail_tests = False
        assert not posts and {"contents": "write"} not in minted
        assert await run((21, 22)) == "https://github.com/owner/repo" + "/commit/" + "f" * 40
        assert await run((21, 22)) == "https://github.com/owner/repo/commit/" + "f" * 40
        assert posts.count("/repos/owner/repo/git/refs") == 1
        head = "c" * 40
        with pytest.raises(FixError, match="current"):
            await run((21, 22))


@pytest.mark.anyio
async def test_signed_owner_webhook_only_enqueues_matching_installation(
    app_setup: tuple[GitHubAppSettings, rsa.RSAPublicKey],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import hmac
    import sqlite3
    from contextlib import closing

    from repo_surgeon import fix_webhook
    from repo_surgeon.settings import Settings

    config = Settings(github_app=app_setup[0], repository_storage=tmp_path / "repos")
    monkeypatch.setattr(fix_webhook, "Settings", lambda: config)
    secret = "s" * 40
    monkeypatch.setenv("REPO_SURGEON_FIX_WEBHOOK_SECRET", secret)
    monkeypatch.setenv("REPO_SURGEON_FIX_TEST_IMAGE", "sha256:" + "c" * 64)
    monkeypatch.setenv("REPO_SURGEON_FIX_TEST_FILE", "backend/test_api.py")
    app = fix_webhook.create_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://localhost"
    ) as client:
        event: dict[str, Any] = {
            "action": "created",
            "issue": {"number": 3, "pull_request": {}},
            "repository": {"id": 42, "owner": {"type": "User", "id": 17}},
            "installation": {"id": 456},
            "sender": {"id": 17},
            "comment": {
                "id": 36,
                "user": {"id": 17, "type": "User"},
                "body": "/repo-surgeon preview 11",
            },
        }

        async def send(key: str = secret) -> int:
            data = json.dumps(event).encode()
            signature = hmac.digest(key.encode(), data, "sha256").hex()
            response = await client.post(
                "/github/events",
                content=data,
                headers={
                    "x-hub-signature-256": "sha256=" + signature,
                    "x-github-event": "issue_comment",
                },
            )
            return response.status_code

        assert await send("wrong") == 401
        event["sender"]["id"] = 18
        assert await send() == 204
        event["sender"]["id"] = 17
        event["installation"]["id"] = 7
        assert await send() == 204
        event["installation"]["id"] = 456
        assert await send() == 202
        assert await send() == 202
        with closing(sqlite3.connect(tmp_path / "fix-bot/42/deliveries.sqlite3")) as db:
            assert db.execute("SELECT comment,state FROM jobs").fetchall() == [(36, "pending")]


@pytest.mark.anyio
async def test_webhook_requires_tested_approval_before_apply(tmp_path: Path) -> None:
    import sqlite3
    from contextlib import closing
    from unittest.mock import AsyncMock, MagicMock

    from repo_surgeon.application.fix_suggestion import Fix
    from repo_surgeon.fix_webhook import Job, deliver

    fix = Fix(
        42,
        17,
        3,
        11,
        "a" * 40,
        "code.py",
        "n = 0\n",
        "n = 1\n",
        "sha256:" + "d" * 64,
        "test_code.py",
    )
    bot = MagicMock(spec=FixBot)
    bot.app = MagicMock(spec=GitHubAppInstallation)
    bot.client = MagicMock(spec=httpx.AsyncClient)
    bot.app.access_token = AsyncMock(return_value="fixture-read")
    bot.app.fix_comment_token = AsyncMock(return_value="fixture-comment")
    bot.target = AsyncMock(return_value=("owner/repo", 17, fix.base))
    bot.preview = AsyncMock(return_value=fix)
    bot.apply = AsyncMock(return_value="https://github.com/owner/repo/commit/example")
    db_path = tmp_path / "jobs.db"
    with closing(sqlite3.connect(db_path)) as db:
        db.execute("CREATE TABLE approvals(comment INTEGER PRIMARY KEY,pull INTEGER,digest TEXT)")

    async def send(cid: int, body: str) -> str:
        await deliver(bot, Job(3, cid, body), fix.image, fix.test, db_path)
        return str(bot.request.await_args.kwargs["data"]["body"])

    assert "required" in await send(22, fix.apply_command(21))
    bot.apply.assert_not_awaited()
    assert "Tested fix preview" in await send(20, "/repo-surgeon preview 11")
    assert "changed" in await send(21, "/repo-surgeon approve " + "0" * 64 + " 11")
    assert fix.apply_command(21) in await send(21, fix.preview_text.splitlines()[-1])
    assert "View commit" in await send(22, fix.apply_command(21))
    bot.apply.assert_awaited_once_with(3, 11, fix.image, fix.test, (21, 22))
