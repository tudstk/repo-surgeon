"""Versioned tenant product sessions, bounded turns, and resumable SSE."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from repo_surgeon.agent.provider import deterministic_read_only_provider
from repo_surgeon.api.dependencies import (
    CurrentPrincipal,
    DatabaseSession,
    MutationPrincipal,
)
from repo_surgeon.api.problems import ProblemDetail, problem
from repo_surgeon.application.agent_sessions import (
    CreateConversationSession,
    EventCursorInvalidError,
    RunPersistedReadOnlyTurn,
    TurnExecutionError,
)
from repo_surgeon.domain.sessions import AgentRun, ConversationSession, NormalizedRunEvent
from repo_surgeon.infrastructure.agent_session_store import SqlAlchemyAgentSessionStore
from repo_surgeon.infrastructure.repository_store import SqlAlchemyRepositoryStore

router = APIRouter(prefix="/api/v1", tags=["agent sessions"])


class CreateSessionRequest(BaseModel):
    repository_id: UUID
    title: str = Field(min_length=1, max_length=200)


class SessionResponse(BaseModel):
    id: UUID
    repository_id: UUID
    title: str
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_domain(cls, session: ConversationSession) -> SessionResponse:
        return cls(
            id=session.id,
            repository_id=session.repository_id,
            title=session.title,
            status=session.status.value,
            created_at=session.created_at,
            updated_at=session.updated_at,
        )


class PersistedTurnResponse(BaseModel):
    run_id: UUID
    status: str
    question: str
    answer: str
    started_at: datetime
    completed_at: datetime | None

    @classmethod
    def from_domain(cls, run: AgentRun) -> PersistedTurnResponse:
        return cls(
            run_id=run.id,
            status=run.status.value,
            question=run.question,
            answer=run.answer,
            started_at=run.started_at,
            completed_at=run.completed_at,
        )


class SessionDetailResponse(SessionResponse):
    turns: list[PersistedTurnResponse]


class CreateTurnRequest(BaseModel):
    message: str = Field(min_length=3, max_length=2_000)


def _session_not_found() -> Exception:
    return problem(
        code="session_not_found",
        title="Session not found",
        status=status.HTTP_404_NOT_FOUND,
        detail="No owned product session has this identifier.",
    )


def _run_not_found() -> Exception:
    return problem(
        code="agent_run_not_found",
        title="Agent run not found",
        status=status.HTTP_404_NOT_FOUND,
        detail="No owned agent run has this identifier.",
    )


@router.post(
    "/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ProblemDetail}},
)
async def create_session(
    body: CreateSessionRequest,
    response: Response,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> SessionResponse:
    response.headers["Cache-Control"] = "no-store"
    created = await CreateConversationSession(
        SqlAlchemyAgentSessionStore(database, principal.user_id)
    ).execute(body.repository_id, body.title, datetime.now(UTC))
    if created is None:
        raise problem(
            code="repository_not_found",
            title="Repository not found",
            status=status.HTTP_404_NOT_FOUND,
            detail="No owned repository has this identifier.",
        )
    return SessionResponse.from_domain(created)


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    repository_id: Annotated[UUID | None, Query()] = None,
) -> list[SessionResponse]:
    response.headers["Cache-Control"] = "no-store"
    sessions = await SqlAlchemyAgentSessionStore(database, principal.user_id).list_sessions(
        repository_id
    )
    return [SessionResponse.from_domain(session) for session in sessions]


@router.get(
    "/sessions/{session_id}",
    response_model=SessionDetailResponse,
    responses={404: {"model": ProblemDetail}},
)
async def get_session(
    session_id: UUID,
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> SessionDetailResponse:
    response.headers["Cache-Control"] = "no-store"
    detail = await SqlAlchemyAgentSessionStore(database, principal.user_id).get_session_with_runs(
        session_id
    )
    if detail is None:
        raise _session_not_found()
    session = SessionResponse.from_domain(detail.session)
    return SessionDetailResponse(
        **session.model_dump(),
        turns=[PersistedTurnResponse.from_domain(run) for run in detail.runs],
    )


@router.post(
    "/sessions/{session_id}/turns",
    response_model=PersistedTurnResponse,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ProblemDetail}},
)
async def create_turn(
    session_id: UUID,
    body: CreateTurnRequest,
    response: Response,
    principal: MutationPrincipal,
    database: DatabaseSession,
) -> PersistedTurnResponse:
    response.headers["Cache-Control"] = "no-store"
    service = RunPersistedReadOnlyTurn(
        SqlAlchemyAgentSessionStore(database, principal.user_id),
        SqlAlchemyRepositoryStore(database, principal.user_id),
        deterministic_read_only_provider,
    )
    try:
        run = await service.execute(session_id, body.message, datetime.now(UTC))
    except TurnExecutionError as error:
        raise problem(
            code="turn_execution_failed",
            title="Turn execution failed",
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The bounded read-only turn could not be completed.",
        ) from error
    if run is None:
        raise _session_not_found()
    return PersistedTurnResponse.from_domain(run)


def _event_envelope(event: NormalizedRunEvent) -> dict[str, object]:
    return {
        "event_id": str(event.event_id),
        "run_id": str(event.run_id),
        "sequence": event.sequence,
        "type": event.type.value,
        "occurred_at": event.occurred_at.isoformat(),
        "data": event.data,
    }


async def _stream_events(events: tuple[NormalizedRunEvent, ...]) -> AsyncIterator[str]:
    yield ": persisted-event-stream\n\n"
    for event in events:
        data = json.dumps(_event_envelope(event), separators=(",", ":"))
        yield f"id: {event.event_id}\nevent: {event.type.value}\ndata: {data}\n\n"


@router.get(
    "/agent-runs/{run_id}/events",
    responses={404: {"model": ProblemDetail}},
)
async def get_run_events(
    run_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    cursor: UUID | None = None
    if last_event_id:
        try:
            cursor = UUID(last_event_id)
        except ValueError as error:
            raise problem(
                code="event_cursor_invalid",
                title="Event cursor invalid",
                status=status.HTTP_400_BAD_REQUEST,
                detail="Last-Event-ID must identify an event in this agent run.",
            ) from error
    try:
        events = await SqlAlchemyAgentSessionStore(database, principal.user_id).list_events(
            run_id, cursor
        )
    except EventCursorInvalidError as error:
        raise problem(
            code="event_cursor_invalid",
            title="Event cursor invalid",
            status=status.HTTP_400_BAD_REQUEST,
            detail="Last-Event-ID must identify an event in this agent run.",
        ) from error
    if events is None:
        raise _run_not_found()
    return StreamingResponse(
        _stream_events(events),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )
