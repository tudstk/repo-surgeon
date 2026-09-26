"""SQLAlchemy persistence for product sessions and normalized run events."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.agent.loop import AgentTurn, ToolEvent
from repo_surgeon.application.agent_sessions import EventCursorInvalidError
from repo_surgeon.domain.sessions import (
    AgentRun,
    AgentRunStatus,
    ConversationSession,
    ConversationSessionStatus,
    NormalizedRunEvent,
    RunEventType,
    SessionWithRuns,
)
from repo_surgeon.infrastructure.repository_models import RepositoryRecord
from repo_surgeon.infrastructure.run_models import (
    AgentRunRecord,
    ConversationSessionRecord,
    RunEventRecord,
    ToolCallRecord,
)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _session(record: ConversationSessionRecord) -> ConversationSession:
    return ConversationSession(
        id=record.id,
        owner_user_id=record.owner_user_id,
        repository_id=record.repository_id,
        title=record.title,
        status=ConversationSessionStatus(record.status),
        created_at=_aware(record.created_at),
        updated_at=_aware(record.updated_at),
    )


def _run(record: AgentRunRecord) -> AgentRun:
    return AgentRun(
        id=record.id,
        owner_user_id=record.owner_user_id,
        session_id=record.session_id,
        correlation_id=record.correlation_id,
        status=AgentRunStatus(record.status),
        question=record.question,
        answer=record.answer,
        stop_reason=record.stop_reason,
        model_calls=record.model_calls,
        tool_calls=record.tool_calls,
        returned_bytes=record.returned_bytes,
        started_at=_aware(record.started_at),
        completed_at=_aware(record.completed_at) if record.completed_at else None,
    )


def _event(record: RunEventRecord) -> NormalizedRunEvent:
    return NormalizedRunEvent(
        event_id=record.id,
        run_id=record.agent_run_id,
        sequence=record.sequence,
        type=RunEventType(record.event_type),
        occurred_at=_aware(record.occurred_at),
        data=record.event_data,
    )


def _result_summary(event: ToolEvent) -> dict[str, object]:
    return {
        "summary": event.summary,
        "duration_ms": event.duration_ms,
        "match_count": event.match_count,
        "truncated": event.truncated,
        "error_code": event.error_code,
        "citations": [
            {
                "path": citation.path,
                "match_line": citation.match_line,
                "start_line": citation.start_line,
                "end_line": citation.end_line,
                "label": citation.label,
                "source": citation.source,
            }
            for citation in event.citations
        ],
    }


class SqlAlchemyAgentSessionStore:
    """Owner-scoped store whose queries never load another tenant's aggregate."""

    def __init__(self, database: AsyncSession, owner_user_id: UUID) -> None:
        self._database = database
        self._owner_user_id = owner_user_id

    async def create_session(
        self, repository_id: UUID, title: str, now: datetime
    ) -> ConversationSession | None:
        repository = (
            await self._database.execute(
                select(RepositoryRecord).where(
                    RepositoryRecord.id == repository_id,
                    RepositoryRecord.owner_user_id == self._owner_user_id,
                )
            )
        ).scalar_one_or_none()
        if repository is None:
            return None
        record = ConversationSessionRecord(
            owner_user_id=self._owner_user_id,
            repository_id=repository.id,
            title=title,
            status=ConversationSessionStatus.ACTIVE.value,
            created_at=now,
            updated_at=now,
        )
        self._database.add(record)
        await self._database.commit()
        await self._database.refresh(record)
        return _session(record)

    async def list_sessions(
        self, repository_id: UUID | None = None
    ) -> tuple[ConversationSession, ...]:
        statement = select(ConversationSessionRecord).where(
            ConversationSessionRecord.owner_user_id == self._owner_user_id
        )
        if repository_id is not None:
            statement = statement.where(ConversationSessionRecord.repository_id == repository_id)
        records = (
            await self._database.execute(
                statement.order_by(
                    ConversationSessionRecord.updated_at.desc(),
                    ConversationSessionRecord.id.desc(),
                )
            )
        ).scalars()
        return tuple(_session(record) for record in records)

    async def get_session(self, session_id: UUID) -> ConversationSession | None:
        record = (
            await self._database.execute(
                select(ConversationSessionRecord).where(
                    ConversationSessionRecord.id == session_id,
                    ConversationSessionRecord.owner_user_id == self._owner_user_id,
                )
            )
        ).scalar_one_or_none()
        return _session(record) if record else None

    async def get_session_with_runs(self, session_id: UUID) -> SessionWithRuns | None:
        session = await self.get_session(session_id)
        if session is None:
            return None
        records = (
            await self._database.execute(
                select(AgentRunRecord)
                .where(
                    AgentRunRecord.session_id == session_id,
                    AgentRunRecord.owner_user_id == self._owner_user_id,
                )
                .order_by(AgentRunRecord.started_at, AgentRunRecord.id)
            )
        ).scalars()
        return SessionWithRuns(session, tuple(_run(record) for record in records))

    async def start_run(self, session_id: UUID, question: str, now: datetime) -> AgentRun | None:
        session_record = (
            await self._database.execute(
                select(ConversationSessionRecord).where(
                    ConversationSessionRecord.id == session_id,
                    ConversationSessionRecord.owner_user_id == self._owner_user_id,
                )
            )
        ).scalar_one_or_none()
        if session_record is None:
            return None
        record = AgentRunRecord(
            owner_user_id=self._owner_user_id,
            session_id=session_id,
            correlation_id=uuid4(),
            status=AgentRunStatus.RUNNING.value,
            question=question,
            answer="",
            stop_reason=None,
            model_calls=0,
            tool_calls=0,
            returned_bytes=0,
            started_at=now,
            completed_at=None,
        )
        self._database.add(record)
        await self._database.flush()
        self._database.add_all(
            [
                RunEventRecord(
                    owner_user_id=self._owner_user_id,
                    agent_run_id=record.id,
                    sequence=1,
                    event_type=RunEventType.RUN_STARTED.value,
                    event_data={
                        "session_id": str(session_id),
                        "repository_id": str(session_record.repository_id),
                    },
                    occurred_at=now,
                ),
                RunEventRecord(
                    owner_user_id=self._owner_user_id,
                    agent_run_id=record.id,
                    sequence=2,
                    event_type=RunEventType.PROGRESS_UPDATED.value,
                    event_data={
                        "message": "Inspecting the repository with bounded read-only tools."
                    },
                    occurred_at=now,
                ),
            ]
        )
        await self._database.commit()
        await self._database.refresh(record)
        return _run(record)

    async def complete_run(self, run_id: UUID, result: AgentTurn, now: datetime) -> AgentRun:
        record = await self._owned_run_record(run_id)
        if record is None:
            raise LookupError("agent run disappeared before completion")
        sequence = 2
        for tool_index, tool_event in enumerate(result.events, start=1):
            tool_call_id = uuid4()
            summary = _result_summary(tool_event)
            self._database.add(
                ToolCallRecord(
                    id=tool_call_id,
                    owner_user_id=self._owner_user_id,
                    agent_run_id=record.id,
                    provider_call_id=tool_event.call_id,
                    sequence=tool_index,
                    tool_name=tool_event.name,
                    validated_arguments=tool_event.arguments,
                    result_summary=summary,
                    status=tool_event.status,
                    duration_ms=tool_event.duration_ms,
                    started_at=now,
                    completed_at=now,
                )
            )
            common_data: dict[str, object] = {
                "tool_call_id": str(tool_call_id),
                "provider_call_id": tool_event.call_id,
                "tool": tool_event.name,
            }
            for event_type, data in (
                (
                    RunEventType.TOOL_REQUESTED,
                    {**common_data, "arguments": tool_event.arguments},
                ),
                (RunEventType.TOOL_STARTED, common_data),
                (
                    RunEventType.TOOL_COMPLETED
                    if tool_event.status == "success"
                    else RunEventType.TOOL_FAILED,
                    {**common_data, "status": tool_event.status, "result": summary},
                ),
            ):
                sequence += 1
                self._database.add(
                    RunEventRecord(
                        owner_user_id=self._owner_user_id,
                        agent_run_id=record.id,
                        sequence=sequence,
                        event_type=event_type.value,
                        event_data=data,
                        occurred_at=now,
                    )
                )
        sequence += 1
        self._database.add(
            RunEventRecord(
                owner_user_id=self._owner_user_id,
                agent_run_id=record.id,
                sequence=sequence,
                event_type=RunEventType.ANSWER_COMPLETED.value,
                event_data={"content": result.answer},
                occurred_at=now,
            )
        )
        status = (
            AgentRunStatus.COMPLETED
            if result.status == "complete"
            else AgentRunStatus.LIMIT_REACHED
        )
        sequence += 1
        self._database.add(
            RunEventRecord(
                owner_user_id=self._owner_user_id,
                agent_run_id=record.id,
                sequence=sequence,
                event_type=RunEventType.RUN_COMPLETED.value,
                event_data={
                    "status": status.value,
                    "stop_reason": result.stop_reason,
                    "model_calls": result.model_calls,
                    "tool_calls": result.tool_calls,
                    "returned_bytes": result.returned_bytes,
                },
                occurred_at=now,
            )
        )
        record.status = status.value
        record.answer = result.answer
        record.stop_reason = result.stop_reason
        record.model_calls = result.model_calls
        record.tool_calls = result.tool_calls
        record.returned_bytes = result.returned_bytes
        record.completed_at = now
        session_record = await self._database.get(ConversationSessionRecord, record.session_id)
        if session_record is not None:
            session_record.updated_at = now
        await self._database.commit()
        await self._database.refresh(record)
        return _run(record)

    async def fail_run(self, run_id: UUID, error_code: str, now: datetime) -> None:
        record = await self._owned_run_record(run_id)
        if record is None:
            return
        last_sequence = (
            await self._database.execute(
                select(RunEventRecord.sequence)
                .where(RunEventRecord.agent_run_id == run_id)
                .order_by(RunEventRecord.sequence.desc())
                .limit(1)
            )
        ).scalar_one()
        record.status = AgentRunStatus.FAILED.value
        record.stop_reason = error_code
        record.completed_at = now
        self._database.add(
            RunEventRecord(
                owner_user_id=self._owner_user_id,
                agent_run_id=run_id,
                sequence=last_sequence + 1,
                event_type=RunEventType.RUN_FAILED.value,
                event_data={"code": error_code},
                occurred_at=now,
            )
        )
        await self._database.commit()

    async def get_run(self, run_id: UUID) -> AgentRun | None:
        record = await self._owned_run_record(run_id)
        return _run(record) if record else None

    async def list_events(
        self, run_id: UUID, after_event_id: UUID | None = None
    ) -> tuple[NormalizedRunEvent, ...] | None:
        if await self._owned_run_record(run_id) is None:
            return None
        after_sequence = 0
        if after_event_id is not None:
            cursor = (
                await self._database.execute(
                    select(RunEventRecord).where(
                        RunEventRecord.id == after_event_id,
                        RunEventRecord.agent_run_id == run_id,
                        RunEventRecord.owner_user_id == self._owner_user_id,
                    )
                )
            ).scalar_one_or_none()
            if cursor is None:
                raise EventCursorInvalidError
            after_sequence = cursor.sequence
        records = (
            await self._database.execute(
                select(RunEventRecord)
                .where(
                    RunEventRecord.agent_run_id == run_id,
                    RunEventRecord.owner_user_id == self._owner_user_id,
                    RunEventRecord.sequence > after_sequence,
                )
                .order_by(RunEventRecord.sequence)
            )
        ).scalars()
        return tuple(_event(record) for record in records)

    async def _owned_run_record(self, run_id: UUID) -> AgentRunRecord | None:
        return (
            await self._database.execute(
                select(AgentRunRecord).where(
                    AgentRunRecord.id == run_id,
                    AgentRunRecord.owner_user_id == self._owner_user_id,
                )
            )
        ).scalar_one_or_none()
