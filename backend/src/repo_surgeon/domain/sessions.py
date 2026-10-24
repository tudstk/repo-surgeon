"""Tenant-scoped conversation, agent-run, tool-call, and event concepts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class ConversationSessionStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class AgentRunStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    LIMIT_REACHED = "limit_reached"
    FAILED = "failed"


class RunEventType(StrEnum):
    RUN_STARTED = "run.started"
    PROGRESS_UPDATED = "progress.updated"
    TOOL_REQUESTED = "tool.requested"
    TOOL_STARTED = "tool.started"
    TOOL_COMPLETED = "tool.completed"
    TOOL_FAILED = "tool.failed"
    ANSWER_COMPLETED = "answer.completed"
    RUN_FAILED = "run.failed"
    RUN_COMPLETED = "run.completed"


@dataclass(frozen=True, slots=True)
class ConversationSession:
    id: UUID
    owner_user_id: UUID
    repository_id: UUID
    title: str
    status: ConversationSessionStatus
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class AgentRun:
    id: UUID
    owner_user_id: UUID
    session_id: UUID
    correlation_id: UUID
    status: AgentRunStatus
    question: str
    answer: str
    stop_reason: str | None
    model_calls: int
    tool_calls: int
    returned_bytes: int
    started_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class NormalizedRunEvent:
    event_id: UUID
    run_id: UUID
    sequence: int
    type: RunEventType
    occurred_at: datetime
    data: dict[str, object]


@dataclass(frozen=True, slots=True)
class SessionWithRuns:
    session: ConversationSession
    runs: tuple[AgentRun, ...]
