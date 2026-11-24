"""Standalone GitHub App webhook. Run with the uvicorn factory documented in the guide."""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, Response

from repo_surgeon.application.fix_suggestion import FixError, source_path
from repo_surgeon.application.redaction import redact_text
from repo_surgeon.application.repository_files import RepositoryFileError
from repo_surgeon.fix_bot import FixBot
from repo_surgeon.infrastructure.github_app import GitHubAppError, GitHubAppInstallation
from repo_surgeon.infrastructure.github_import import GitHubImportError
from repo_surgeon.settings import Settings

PREVIEW = re.compile(r"/repo-surgeon preview ([1-9][0-9]{0,18})")
APPLY = re.compile(
    r"/repo-surgeon apply [a-f0-9]{64} repo-surgeon/fix-[0-9]+-[a-f0-9]{16} "
    r"([1-9][0-9]{0,18}) ([1-9][0-9]{0,18})"
)
APPROVE = re.compile(r"/repo-surgeon approve ([a-f0-9]{64}) ([1-9][0-9]{0,18})")


@dataclass(frozen=True)
class Job:
    pull: int
    comment: int
    body: str


def owner_job(event: dict[str, Any], repository: int, installation: int) -> Job | None:
    if event.get("action") != "created" or "pull_request" not in event.get("issue", {}):
        return None
    repo, comment = event["repository"], event["comment"]
    if (
        repo["id"] != repository
        or event["installation"]["id"] != installation
        or repo["owner"]["type"] != "User"
        or comment["user"]["type"] != "User"
        or repo["owner"]["id"] != comment["user"]["id"]
        or event["sender"]["id"] != repo["owner"]["id"]
    ):
        return None
    body = comment["body"].strip()
    if not any(pattern.fullmatch(body) for pattern in (PREVIEW, APPROVE, APPLY)):
        return None
    return Job(int(event["issue"]["number"]), int(comment["id"]), body)


async def deliver(bot: FixBot, job: Job, image: str, test: str, db_path: Path) -> None:
    read = await bot.app.access_token(bot.client, permission="pull_requests")
    name, _, _ = await bot.target(job.pull, read)
    try:
        if preview := PREVIEW.fullmatch(job.body):
            fix = await bot.preview(job.pull, int(preview[1]), image, test)
            output = fix.preview_text
            # An arbitrary source line cannot close this Markdown block.
            longest = max((len(run) for run in re.findall(r"`+", output)), default=0)
            fence = "`" * max(3, longest + 1)
            if len(output) + 2 * len(fence) > 60000:
                raise FixError("This preview is too long for a GitHub comment.")
            reply = f"**Tested fix preview**\n\n{fence}text\n{output}\n{fence}"
        elif apply := APPLY.fullmatch(job.body):
            with closing(sqlite3.connect(db_path)) as db:
                approved = db.execute(
                    "SELECT digest FROM approvals WHERE comment=? AND pull=?",
                    (int(apply[2]), job.pull),
                ).fetchone()
            if approved != (job.body.split()[2],):
                raise FixError("A tested approval from the repository owner is required.")
            url = await bot.apply(
                job.pull, int(apply[1]), image, test, (int(apply[2]), job.comment)
            )
            reply = f"Published the approved fix. [View commit]({url})."
        elif approval := APPROVE.fullmatch(job.body):
            fix = await bot.preview(job.pull, int(approval[2]), image, test)
            if fix.digest != approval[1]:
                raise FixError("The revision or test configuration changed. Request a new preview.")
            with closing(sqlite3.connect(db_path)) as db:
                db.execute(
                    "INSERT OR IGNORE INTO approvals VALUES (?,?,?)",
                    (job.comment, job.pull, fix.digest),
                )
                db.commit()
            reply = (
                f"Approved revision `{fix.digest[:12]}`. To publish it on `{fix.branch}`, "
                f"post a new PR comment:\n\n```text\n{fix.apply_command(job.comment)}\n```"
            )
        else:
            return
    except (FixError, GitHubAppError, GitHubImportError, RepositoryFileError) as exc:
        reply = f"Repo Surgeon stopped. {exc}"
    token = await bot.app.fix_comment_token(bot.client)
    await bot.request(
        f"/repos/{name}/issues/{job.pull}/comments", token, data={"body": redact_text(reply)}
    )


def create_app() -> FastAPI:
    settings = Settings()
    config = settings.github_app
    if config is None:
        raise RuntimeError("Configure the single-repository GitHub App installation.")
    secret = os.environ["REPO_SURGEON_FIX_WEBHOOK_SECRET"].encode()
    image = os.environ["REPO_SURGEON_FIX_TEST_IMAGE"]
    test = source_path(os.environ["REPO_SURGEON_FIX_TEST_FILE"])
    if len(secret) < 32 or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise RuntimeError("Configure a strong webhook secret and immutable test image ID.")
    installation = GitHubAppInstallation(config)
    directory = settings.repository_storage.parent / "fix-bot" / str(config.repository_id)
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    db_path = directory / "deliveries.sqlite3"
    with closing(sqlite3.connect(db_path)) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS jobs (comment INTEGER PRIMARY KEY, "
            "pull INTEGER, body TEXT, state TEXT)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS approvals (comment INTEGER PRIMARY KEY, "
            "pull INTEGER, digest TEXT)"
        )
        db.commit()
    wake = asyncio.Event()

    async def process(bot: FixBot) -> None:
        while True:
            await wake.wait()
            wake.clear()
            while True:
                with closing(sqlite3.connect(db_path)) as db:
                    row = db.execute(
                        "SELECT pull,comment,body FROM jobs WHERE state='pending' "
                        "ORDER BY comment LIMIT 1"
                    ).fetchone()
                if row is None:
                    break
                job = Job(*row)
                try:
                    await deliver(bot, job, image, test, db_path)
                    state = "done"
                except Exception:
                    # GitHub errors and parser exceptions may contain private source or signed URLs.
                    logging.getLogger(__name__).error(
                        "Fix delivery %d failed. Redeliver the owner comment.", job.comment
                    )
                    state = "failed"
                with closing(sqlite3.connect(db_path)) as db:
                    db.execute("UPDATE jobs SET state=? WHERE comment=?", (state, job.comment))
                    db.commit()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(timeout=20) as client:
            worker = asyncio.create_task(process(FixBot(client, installation)))
            wake.set()
            try:
                yield
            finally:
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.post("/github/events")
    async def events(request: Request) -> Response:
        payload = bytearray()
        async for chunk in request.stream():
            payload.extend(chunk)
            if len(payload) > 256 * 1024:
                raise HTTPException(413)
        expected = "sha256=" + hmac.new(secret, payload, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(
            request.headers.get("x-hub-signature-256", "").encode(), expected.encode()
        ):
            raise HTTPException(401)
        if request.headers.get("x-github-event") != "issue_comment":
            return Response(status_code=204)
        try:
            job = owner_job(json.loads(payload), config.repository_id, config.installation_id)
        except KeyError, TypeError, ValueError, AttributeError:
            raise HTTPException(400) from None
        if job is None:
            return Response(status_code=204)
        with closing(sqlite3.connect(db_path)) as db:
            db.execute(
                "INSERT INTO jobs(comment,pull,body,state) VALUES (?,?,?,'pending') "
                "ON CONFLICT(comment) DO UPDATE SET state='pending' WHERE state='failed'",
                (job.comment, job.pull, job.body),
            )
            db.commit()
        wake.set()
        return Response(status_code=202)

    return app
