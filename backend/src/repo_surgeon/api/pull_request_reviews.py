"""Authenticated, retry-safe PR review streaming with saved user-visible answers."""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID

import anyio
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from repo_surgeon.agent.loop import AgentTurn, ToolEvent
from repo_surgeon.api.agent_sessions import PersistedTurnResponse
from repo_surgeon.api.dependencies import CurrentPrincipal, DatabaseSession, MutationPrincipal
from repo_surgeon.api.problems import problem
from repo_surgeon.application.agent_sessions import SessionBusyError
from repo_surgeon.application.redaction import redact_text
from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.application.repository_files import RepositoryFileError
from repo_surgeon.application.review_catalog import (
    REVIEW_MODELS,
    review_model,
)
from repo_surgeon.application.review_context import build_review_context
from repo_surgeon.application.review_models import PullReviewSource, RepositoryChatSource
from repo_surgeon.infrastructure.agent_session_store import SqlAlchemyAgentSessionStore
from repo_surgeon.infrastructure.github_import import GitHubImporter, GitHubImportError
from repo_surgeon.infrastructure.openrouter_review import (
    CHAT_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    OpenRouterReview,
    ReviewProvider,
    ReviewProviderError,
    SimulatedReview,
)
from repo_surgeon.infrastructure.repository_store import SqlAlchemyRepositoryStore

router = APIRouter(prefix="/api/v1", tags=["pull request reviews"])


class CreateReviewRequest(BaseModel):
    number: int = Field(ge=1, le=2**31 - 1)
    request_id: UUID
    model: str | None = Field(default=None, max_length=128)


class CreateMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    request_id: UUID
    model: str | None = Field(default=None, max_length=128)


def _frame(kind: str, payload: object) -> str:
    return f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=True)}\n\n"


class _VisibleAnswer:
    """Wait for line boundaries before redacting potential credential fragments."""

    def __init__(self) -> None:
        self.pending = ""
        self.pem = False

    def accept(self, text: str, *, finished: bool = False) -> str:
        self.pending += text
        output = []
        lines = self.pending.splitlines(keepends=True)
        self.pending = ""
        if lines and not finished and not lines[-1].endswith(("\n", "\r")):
            self.pending = lines.pop()
        for line in lines:
            if "-----BEGIN " in line:
                self.pem = True
            if self.pem:
                if "-----END " in line:
                    self.pem = False
                    output.append("[REDACTED PEM]\n")
                continue
            output.append(redact_text(line))
        if len(self.pending) > 16_000:
            raise ReviewProviderError("The model returned an oversized unbroken line.")
        return "".join(output)


@router.get("/review-provider")
async def review_provider(
    request: Request, response: Response, _principal: CurrentPrincipal
) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    settings = request.app.state.settings
    simulation = settings.review_mode == "simulation"
    return {
        "repository_chat": True,
        "available": simulation or settings.openrouter_api_key is not None,
        "simulation": simulation,
        "model": "Simulation" if simulation else settings.openrouter_model,
        "default_model": settings.openrouter_model,
        "models": [
            {"id": model.id, "name": model.name, "description": model.description}
            for model in REVIEW_MODELS
        ],
    }


async def _create_model_response(
    session_id: UUID,
    body: CreateReviewRequest | CreateMessageRequest,
    request: Request,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> StreamingResponse:
    chat = isinstance(body, CreateMessageRequest)
    store = SqlAlchemyAgentSessionStore(database, principal.user_id)
    session = await store.get_session(session_id)
    if session is None:
        raise problem(
            code="session_not_found",
            title="Session not found",
            status=404,
            detail="No owned product session has this identifier.",
        )
    repository = await SqlAlchemyRepositoryStore(database, principal.user_id).get(
        session.repository_id
    )
    if repository is None or (
        not chat and (not repository.github_full_name or not repository.github_commit)
    ):
        raise problem(
            code="review_repository_unavailable",
            title="Review unavailable",
            status=404,
            detail="Select an owned imported GitHub repository to review a pull request.",
        )
    settings = request.app.state.settings
    simulation = settings.review_mode == "simulation"
    if not simulation and settings.openrouter_api_key is None:
        raise problem(
            code="review_provider_unconfigured",
            title="Review unavailable",
            status=503,
            detail="Configure the OpenRouter API key on the backend, or enable review simulation.",
        )
    try:
        selected = review_model(body.model or settings.openrouter_model)
    except ValueError:
        raise problem(
            code="review_model_unavailable",
            title="Model unavailable",
            status=422,
            detail="Choose one of the available review models.",
        ) from None
    settings = settings.model_copy(update={"openrouter_model": selected.id})
    metadata: dict[str, object] = {
        **(
            {"kind": "repository_chat"}
            if isinstance(body, CreateMessageRequest)
            else {"number": body.number}
        ),
        "requested_model": selected.id,
        "repository": repository.github_full_name or "Local repository",
        "simulation": simulation,
        "model": "Simulation" if simulation else settings.openrouter_model,
    }
    try:
        run = await store.start_run(
            session_id,
            redact_text(body.message.strip())
            if isinstance(body, CreateMessageRequest)
            else "Code Review this PR",
            datetime.now(UTC),
            review_request_id=body.request_id,
            review_context=metadata,
        )
    except SessionBusyError:
        raise problem(
            code="review_in_progress",
            title="Review in progress",
            status=409,
            detail="A review is already running. Wait for it to finish before starting another.",
        ) from None
    except ValueError:
        raise problem(
            code="review_request_conflict",
            title="Review request conflict",
            status=409,
            detail="Start a new review for the selected pull request.",
        ) from None
    if run is None:
        raise problem(
            code="session_not_found",
            title="Session not found",
            status=404,
            detail="This session is no longer active.",
        )

    async def stream() -> AsyncIterator[str]:
        assert run is not None
        if run.status.value != "running":
            yield _frame(
                "completed", PersistedTurnResponse.from_domain(run).model_dump(mode="json")
            )
            return
        answer = ""
        visible = _VisibleAnswer()
        finalized = False
        provider: ReviewProvider = (
            SimulatedReview(chat=chat)
            if simulation
            else OpenRouterReview(
                settings, system_prompt=CHAT_SYSTEM_PROMPT if chat else REVIEW_SYSTEM_PROMPT
            )
        )
        # Tests inject an in-memory stream here. Production uses the configured adapter.
        if hasattr(request.app.state, "review_provider_factory"):
            provider = request.app.state.review_provider_factory()
        try:
            yield _frame("started", PersistedTurnResponse.from_domain(run).model_dump(mode="json"))
            async with asyncio.timeout(settings.review_timeout_seconds):
                yield _frame(
                    "progress",
                    {
                        "message": "Reading the saved repository snapshot…"
                        if chat
                        else "Loading the pull request and its pinned source…"
                    },
                )
                importer: GitHubImporter = request.app.state.github_importer
                with TemporaryDirectory(prefix="repo-surgeon-review-") as temporary:
                    source: PullReviewSource | RepositoryChatSource
                    if isinstance(body, CreateMessageRequest):
                        if repository.root_device is None or repository.root_inode is None:
                            raise RepositoryFileError(
                                "repository_unavailable", "Recover the repository snapshot first."
                            )
                        previous = await store.recent_model_runs(session_id)
                        history = tuple(
                            {"question": item.question[:2000], "answer": item.answer[:3000]}
                            for item in previous
                        )
                        source = RepositoryChatSource(
                            ResolvedLocalRepositoryRoot(
                                repository.canonical_root,
                                repository.root_device,
                                repository.root_inode,
                            ),
                            redact_text(body.message.strip()),
                            history,
                        )
                    else:
                        source = await importer.review_source(
                            repository, body.number, Path(temporary) / "head"
                        )
                    yield _frame(
                        "progress", {"message": "Mapping dependencies and reading related source…"}
                    )
                    # Keep temporary source alive until the confined worker finishes.
                    worker = asyncio.create_task(asyncio.to_thread(build_review_context, source))
                    try:
                        context = await asyncio.shield(worker)
                    except asyncio.CancelledError:
                        with anyio.CancelScope(shield=True):
                            await worker
                        raise
                    metadata.update(
                        {
                            **(
                                {"head_sha": repository.github_commit}
                                if isinstance(source, RepositoryChatSource)
                                else {
                                    "title": redact_text(source.title),
                                    "base_sha": source.base_sha,
                                    "head_sha": source.head_sha,
                                }
                            ),
                            "file_count": context.file_count,
                            "source_count": context.source_count,
                            "excerpt_count": context.excerpt_count,
                            "limited": context.limited,
                            "input_characters": len(context.text),
                        }
                    )
                    await store.checkpoint_review(run.id, "", metadata)
                    yield _frame("context", metadata)
                    yield _frame(
                        "progress",
                        {
                            "message": "Generating simulated review…"
                            if simulation
                            else "Answering your question…"
                            if chat
                            else "Reviewing the changes…"
                        },
                    )
                    context = replace(context, text=redact_text(context.text))
                    last_checkpoint = time.monotonic()
                    async for delta in provider.stream(context):
                        text = visible.accept(delta)
                        answer += text
                        if len(answer.encode()) > 96_000:
                            raise ReviewProviderError("The review exceeded the answer size limit.")
                        if text:
                            yield _frame("delta", {"text": text})
                        if time.monotonic() - last_checkpoint > 0.75:
                            await store.checkpoint_review(run.id, answer, metadata)
                            last_checkpoint = time.monotonic()
                    tail = visible.accept("", finished=True)
                    answer += tail
                    if tail:
                        yield _frame("delta", {"text": tail})
                    if not answer.strip():
                        raise ReviewProviderError("The model did not return a review.")
                    metadata["usage"] = getattr(provider, "usage", {})
                    limited = bool(getattr(provider, "limited", False))
                    await store.checkpoint_review(run.id, answer, metadata)
                    result = AgentTurn(
                        "limit_reached" if limited else "complete",
                        answer,
                        "output_limit" if limited else None,
                        0 if simulation else 1,
                        1,
                        len(context.text.encode()),
                        (
                            ToolEvent(
                                name="repository_map",
                                status="success",
                                summary=(
                                    f"Mapped {context.source_count} files; "
                                    f"selected {context.excerpt_count} excerpts."
                                ),
                                truncated=context.limited,
                            ),
                        ),
                    )
                    completed = await store.complete_run(run.id, result, datetime.now(UTC))
                    finalized = True
                    yield _frame(
                        "completed",
                        PersistedTurnResponse.from_domain(completed).model_dump(mode="json"),
                    )
        except (
            GitHubImportError,
            ReviewProviderError,
            RepositoryFileError,
            ValueError,
            TimeoutError,
        ) as error:
            if isinstance(error, (GitHubImportError, ReviewProviderError)):
                detail = str(error)
            elif isinstance(error, TimeoutError):
                detail = (
                    "The response reached its time limit. "
                    "Try a more specific question or smaller PR."
                )
            elif isinstance(error, ValueError):
                detail = (
                    "The message exceeds the repository context limits."
                    if chat
                    else "The pull request exceeds the review context limits."
                )
            else:
                detail = "The pinned repository source could not be read."
            metadata["error"] = detail
            await store.rollback()
            await store.checkpoint_review(run.id, answer, metadata)
            await store.fail_run(run.id, "review_failed", datetime.now(UTC))
            finalized = True
            yield _frame("failed", {"detail": detail, "run_id": str(run.id)})
        finally:
            # Disconnects cancel the provider request and leave a recoverable saved failure.
            with anyio.CancelScope(shield=True):
                if isinstance(provider, OpenRouterReview):
                    await provider.aclose()
                if not finalized:
                    with suppress(Exception):
                        await store.rollback()
                        metadata["error"] = (
                            "The review was interrupted. Its partial answer was saved."
                        )
                        await store.checkpoint_review(run.id, answer, metadata)
                        await store.fail_run(run.id, "review_interrupted", datetime.now(UTC))

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/sessions/{session_id}/pull-request-reviews")
async def create_pull_request_review(
    session_id: UUID,
    body: CreateReviewRequest,
    request: Request,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> StreamingResponse:
    return await _create_model_response(session_id, body, request, principal, database)


@router.post("/sessions/{session_id}/repository-messages")
async def create_repository_message(
    session_id: UUID,
    body: CreateMessageRequest,
    request: Request,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> StreamingResponse:
    if not body.message.strip():
        raise problem(
            code="message_empty", title="Empty message", status=422, detail="Write a message first."
        )
    return await _create_model_response(session_id, body, request, principal, database)
