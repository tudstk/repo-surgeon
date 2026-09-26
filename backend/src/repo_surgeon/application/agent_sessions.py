"""Use cases and ports for tenant-scoped persisted read-only turns."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from repo_surgeon.agent.loop import AgentTurn, run_turn
from repo_surgeon.agent.provider import ModelProvider
from repo_surgeon.application.repositories import RepositoryLookup
from repo_surgeon.domain.sessions import (
    AgentRun,
    ConversationSession,
    NormalizedRunEvent,
    SessionWithRuns,
)
from repo_surgeon.mcp.file_tools import McpFileTools


class EventCursorInvalidError(Exception):
    """The supplied SSE cursor is not an event in the requested owned run."""


class TurnExecutionError(Exception):
    """A bounded turn failed after its durable run record was created."""


class AgentSessionStore(Protocol):
    """Tenant-bound persistence operations for product sessions and traces."""

    async def create_session(
        self, repository_id: UUID, title: str, now: datetime
    ) -> ConversationSession | None: ...

    async def list_sessions(
        self, repository_id: UUID | None = None
    ) -> tuple[ConversationSession, ...]: ...

    async def get_session(self, session_id: UUID) -> ConversationSession | None: ...

    async def get_session_with_runs(self, session_id: UUID) -> SessionWithRuns | None: ...

    async def start_run(
        self, session_id: UUID, question: str, now: datetime
    ) -> AgentRun | None: ...

    async def complete_run(self, run_id: UUID, result: AgentTurn, now: datetime) -> AgentRun: ...

    async def fail_run(self, run_id: UUID, error_code: str, now: datetime) -> None: ...

    async def get_run(self, run_id: UUID) -> AgentRun | None: ...

    async def list_events(
        self, run_id: UUID, after_event_id: UUID | None = None
    ) -> tuple[NormalizedRunEvent, ...] | None: ...


@dataclass(frozen=True, slots=True)
class CreateConversationSession:
    store: AgentSessionStore

    async def execute(
        self, repository_id: UUID, title: str, now: datetime
    ) -> ConversationSession | None:
        return await self.store.create_session(repository_id, title, now)


class RunPersistedReadOnlyTurn:
    """Run the existing bounded loop and persist its normalized public trace."""

    def __init__(
        self,
        store: AgentSessionStore,
        repository_lookup: RepositoryLookup,
        provider_factory: Callable[[], ModelProvider],
    ) -> None:
        self._store = store
        self._repository_lookup = repository_lookup
        self._provider_factory = provider_factory

    async def execute(self, session_id: UUID, question: str, now: datetime) -> AgentRun | None:
        session = await self._store.get_session(session_id)
        if session is None:
            return None
        run = await self._store.start_run(session_id, question, now)
        if run is None:
            return None
        try:
            result = await run_turn(
                self._provider_factory(),
                McpFileTools(self._repository_lookup),
                session.repository_id,
                question,
            )
            return await self._store.complete_run(run.id, result, now)
        except Exception as error:
            await self._store.fail_run(run.id, "turn_execution_failed", now)
            raise TurnExecutionError from error
