from datetime import UTC, datetime
from uuid import uuid4

import pytest

from repo_surgeon.agent.loop import AgentTurn
from repo_surgeon.application import agent_sessions
from repo_surgeon.application.agent_sessions import RunPersistedReadOnlyTurn, TurnExecutionError
from repo_surgeon.domain.sessions import AgentRun, AgentRunStatus, ConversationSession


class FailingStore:
    def __init__(self) -> None:
        self.run_id = uuid4()
        self.session_id = uuid4()
        self.repository_id = uuid4()
        self.rollback_called = False
        self.failure_recorded = False

    async def get_session(self, session_id):
        return ConversationSession(
            id=self.session_id,
            owner_user_id=uuid4(),
            repository_id=self.repository_id,
            title="test",
            status="active",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

    async def start_run(self, session_id, question, now):
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

    async def complete_run(self, run_id, result, now):
        raise RuntimeError("commit failed")

    async def rollback(self):
        self.rollback_called = True

    async def fail_run(self, run_id, error_code, now):
        self.failure_recorded = self.rollback_called


@pytest.mark.anyio
async def test_completion_failure_rolls_back_before_recording_run_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = FailingStore()

    async def completed_turn(*args, **kwargs):
        return AgentTurn("complete", "Done", None, 1, 0, 0, ())

    monkeypatch.setattr(agent_sessions, "run_turn", completed_turn)
    service = RunPersistedReadOnlyTurn(store, object(), lambda: object())

    with pytest.raises(TurnExecutionError):
        await service.execute(store.session_id, "Summarize", datetime.now(UTC))

    assert store.rollback_called
    assert store.failure_recorded
