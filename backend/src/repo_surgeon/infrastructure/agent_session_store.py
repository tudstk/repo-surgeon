"""SQLAlchemy persistence for product sessions and normalized run events."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from math import isfinite
from pathlib import Path
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.agent.loop import AgentTurn, ToolEvent
from repo_surgeon.application.agent_sessions import (
    EventCursorInvalidError,
    SessionBusyError,
    SessionTitleConflictError,
)
from repo_surgeon.application.redaction import SENSITIVE_KEY, redact_text
from repo_surgeon.domain.sessions import (
    AgentRun,
    AgentRunStatus,
    ConversationSession,
    ConversationSessionStatus,
    NormalizedRunEvent,
    RunEventType,
    SessionWithRuns,
)
from repo_surgeon.infrastructure.repository_models import RepositoryRecord, UserRecord
from repo_surgeon.infrastructure.run_models import (
    AgentRunRecord,
    ConversationSessionRecord,
    RunEventRecord,
    ToolCallRecord,
)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _redact_value(value: object) -> object:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if SENSITIVE_KEY.search(str(key)) else _redact_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, tuple):
        return [_redact_value(item) for item in value]
    return value


def _redact_mapping(value: dict[str, object]) -> dict[str, object]:
    return cast(dict[str, object], _redact_value(value))


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
        review_context=record.review_context,
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

    async def rollback(self) -> None:
        await self._database.rollback()

    async def create_session(
        self, repository_id: UUID, title: str | None, now: datetime
    ) -> ConversationSession | None:
        repository = (
            await self._database.execute(
                select(RepositoryRecord)
                .where(
                    RepositoryRecord.id == repository_id,
                    RepositoryRecord.owner_user_id == self._owner_user_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if repository is None:
            return None
        name = (repository.github_full_name or Path(repository.canonical_root).name).rsplit("/", 1)[
            -1
        ]
        base = (title or f"{name} read-only review").strip()[:200]
        base = self._short_title(base, repository)
        titles = await self._titles(repository)
        candidate = base
        suffix = 0
        while candidate.casefold() in titles:
            suffix += 1
            ending = f"-{suffix}"
            candidate = base[: 200 - len(ending)] + ending
        record = ConversationSessionRecord(
            owner_user_id=self._owner_user_id,
            repository_id=repository.id,
            title=candidate,
            status=ConversationSessionStatus.ACTIVE.value,
            created_at=now,
            updated_at=now,
        )
        self._database.add(record)
        await self._database.commit()
        await self._database.refresh(record)
        return _session(record)

    @staticmethod
    def _short_title(title: str, repository: RepositoryRecord) -> str:
        if repository.github_full_name and "/" in repository.github_full_name:
            prefix = repository.github_full_name.split("/", 1)[0] + "/"
            return title.removeprefix(prefix) or "Session"
        return title

    async def _titles(self, repository: RepositoryRecord, exclude: UUID | None = None) -> set[str]:
        statement = select(ConversationSessionRecord.title).where(
            ConversationSessionRecord.repository_id == repository.id,
            ConversationSessionRecord.owner_user_id == self._owner_user_id,
        )
        if exclude is not None:
            statement = statement.where(ConversationSessionRecord.id != exclude)
        return {
            self._short_title(title, repository).casefold()
            for title in (await self._database.scalars(statement))
        }

    async def rename_session(
        self, session_id: UUID, title: str, now: datetime
    ) -> ConversationSession | None:
        record = await self._active_session_record(session_id)
        if record is None:
            return None
        repository = (
            await self._database.scalars(
                select(RepositoryRecord)
                .where(
                    RepositoryRecord.id == record.repository_id,
                    RepositoryRecord.owner_user_id == self._owner_user_id,
                )
                .with_for_update()
            )
        ).one()
        title = self._short_title(title, repository)
        if title.casefold() in await self._titles(repository, session_id):
            raise SessionTitleConflictError
        record.title = title
        record.updated_at = now
        await self._database.commit()
        return _session(record)

    async def archive_session(self, session_id: UUID, now: datetime) -> bool:
        record = await self._active_session_record(session_id)
        if record is None:
            return False
        running = await self._database.scalar(
            select(AgentRunRecord.id)
            .where(
                AgentRunRecord.session_id == session_id,
                AgentRunRecord.owner_user_id == self._owner_user_id,
                AgentRunRecord.status == AgentRunStatus.RUNNING.value,
            )
            .limit(1)
        )
        if running is not None:
            raise SessionBusyError
        record.status = ConversationSessionStatus.ARCHIVED.value
        record.updated_at = now
        await self._database.commit()
        return True

    async def _active_session_record(self, session_id: UUID) -> ConversationSessionRecord | None:
        return (
            await self._database.scalars(
                select(ConversationSessionRecord)
                .where(
                    ConversationSessionRecord.id == session_id,
                    ConversationSessionRecord.owner_user_id == self._owner_user_id,
                    ConversationSessionRecord.status == ConversationSessionStatus.ACTIVE.value,
                )
                .with_for_update()
            )
        ).one_or_none()

    async def list_sessions(
        self, repository_id: UUID | None = None
    ) -> tuple[ConversationSession, ...]:
        statement = select(ConversationSessionRecord).where(
            ConversationSessionRecord.owner_user_id == self._owner_user_id,
            ConversationSessionRecord.status == ConversationSessionStatus.ACTIVE.value,
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
                    ConversationSessionRecord.status == ConversationSessionStatus.ACTIVE.value,
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

    async def start_run(
        self,
        session_id: UUID,
        question: str,
        now: datetime,
        *,
        review_request_id: UUID | None = None,
        review_context: dict[str, object] | None = None,
    ) -> AgentRun | None:
        if review_request_id is not None:
            await self._database.execute(
                select(UserRecord.id).where(UserRecord.id == self._owner_user_id).with_for_update()
            )
            existing = (
                await self._database.execute(
                    select(AgentRunRecord).where(
                        AgentRunRecord.owner_user_id == self._owner_user_id,
                        AgentRunRecord.review_request_id == review_request_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                if existing.session_id != session_id or (existing.review_context or {}).get(
                    "number"
                ) != (review_context or {}).get("number"):
                    raise ValueError("This review request belongs to a different selection.")
                if existing.status == "running":
                    if _aware(existing.started_at) < now - timedelta(minutes=6):
                        await self.fail_run(existing.id, "review_interrupted", now)
                        return await self.get_run(existing.id)
                    raise SessionBusyError
                return _run(existing)
            active = await self._database.scalar(
                select(AgentRunRecord.id)
                .where(
                    AgentRunRecord.owner_user_id == self._owner_user_id,
                    AgentRunRecord.review_context.is_not(None),
                    AgentRunRecord.status == "running",
                    AgentRunRecord.started_at > now - timedelta(minutes=6),
                )
                .limit(1)
            )
            if active is not None:
                raise SessionBusyError
        session_record = (
            await self._database.execute(
                select(ConversationSessionRecord)
                .where(
                    ConversationSessionRecord.id == session_id,
                    ConversationSessionRecord.owner_user_id == self._owner_user_id,
                    ConversationSessionRecord.status == ConversationSessionStatus.ACTIVE.value,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if session_record is None:
            return None
        record = AgentRunRecord(
            owner_user_id=self._owner_user_id,
            session_id=session_id,
            correlation_id=uuid4(),
            status=AgentRunStatus.RUNNING.value,
            question=redact_text(question),
            answer="",
            review_request_id=review_request_id,
            review_context=_redact_mapping(review_context) if review_context else None,
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
                        "message": (
                            "Preparing pull request context."
                            if review_context
                            else "Inspecting the repository with bounded read-only tools."
                        )
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
            summary = _redact_mapping(_result_summary(tool_event))
            arguments = _redact_mapping(tool_event.arguments)
            provider_call_id = str(uuid4())
            self._database.add(
                ToolCallRecord(
                    id=tool_call_id,
                    owner_user_id=self._owner_user_id,
                    agent_run_id=record.id,
                    provider_call_id=provider_call_id,
                    sequence=tool_index,
                    tool_name=tool_event.name,
                    validated_arguments=arguments,
                    result_summary=summary,
                    status=tool_event.status,
                    duration_ms=tool_event.duration_ms,
                    started_at=now,
                    completed_at=now,
                )
            )
            common_data: dict[str, object] = {
                "tool_call_id": str(tool_call_id),
                "provider_call_id": provider_call_id,
                "tool": tool_event.name,
            }
            for event_type, data in (
                (
                    RunEventType.TOOL_REQUESTED,
                    {**common_data, "arguments": arguments},
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
                event_data={"content": redact_text(result.answer)},
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
        record.answer = redact_text(result.answer)
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

    async def checkpoint_review(
        self, run_id: UUID, answer: str, context: dict[str, object]
    ) -> None:
        record = await self._owned_run_record(run_id)
        if record is None or record.status != "running":
            raise LookupError("review run is no longer active")
        record.answer = redact_text(answer)
        safe_context = _redact_mapping(context)
        usage = context.get("usage")
        if isinstance(usage, dict):
            safe_context["usage"] = {
                key: value
                for key, value in usage.items()
                if key in {"prompt_tokens", "completion_tokens", "cost"}
                and type(value) in {int, float}
                and isfinite(value)
                and value >= 0
            }
        record.review_context = safe_context
        await self._database.commit()

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
