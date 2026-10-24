from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

import pytest

from repo_surgeon.agent.loop import AgentTurn
from repo_surgeon.agent.provider import ModelProvider
from repo_surgeon.application import agent_sessions
from repo_surgeon.application.agent_sessions import RunPersistedReadOnlyTurn, TurnExecutionError
from repo_surgeon.application.repositories import RepositoryLookup
from repo_surgeon.domain.sessions import (
    AgentRun,
    AgentRunStatus,
    ConversationSession,
    ConversationSessionStatus,
)


class FailingStore:
    def __init__(self) -> None:
        self.run_id = uuid4()
        self.session_id = uuid4()
        self.repository_id = uuid4()
        self.rollback_called = False
        self.failure_recorded = False

    async def get_session(self, session_id: Any) -> ConversationSession:
        return ConversationSession(
            id=self.session_id,
            owner_user_id=uuid4(),
            repository_id=self.repository_id,
            title="test",
            status=ConversationSessionStatus.ACTIVE,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

    async def start_run(self, session_id: Any, question: str, now: datetime) -> AgentRun:
        return AgentRun(
            id=self.run_id,
            owner_user_id=uuid4(),
            session_id=self.session_id,
            correlation_id=uuid4(),
            status=AgentRunStatus.RUNNING,
            question=question,
            answer="",
            stop_reason=None,
            model_calls=0,
            tool_calls=0,
            returned_bytes=0,
            started_at=now,
            completed_at=None,
        )

    async def complete_run(self, run_id: Any, result: AgentTurn, now: datetime) -> AgentRun:
        raise RuntimeError("commit failed")

    async def rollback(self) -> None:
        self.rollback_called = True

    async def fail_run(self, run_id: Any, error_code: str, now: datetime) -> None:
        self.failure_recorded = self.rollback_called


@pytest.mark.anyio
async def test_completion_failure_rolls_back_before_recording_run_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = FailingStore()

    async def completed_turn(*args: Any, **kwargs: Any) -> AgentTurn:
        return AgentTurn("complete", "Done", None, 1, 0, 0, ())

    monkeypatch.setattr(agent_sessions, "run_turn", completed_turn)
    service = RunPersistedReadOnlyTurn(
        cast(agent_sessions.AgentSessionStore, store),
        cast(RepositoryLookup, object()),
        lambda: cast(ModelProvider, object()),
    )

    with pytest.raises(TurnExecutionError):
        await service.execute(store.session_id, "Summarize", datetime.now(UTC))

    assert store.rollback_called
    assert store.failure_recorded
