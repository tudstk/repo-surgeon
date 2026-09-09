"""SQLAlchemy adapter for registered repositories."""

from datetime import UTC
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.infrastructure.repository_models import RepositoryRecord


def _to_domain(record: RepositoryRecord) -> Repository:
    """Map a persistence record without exposing ORM state beyond infrastructure."""
    created_at = record.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return Repository(
        id=record.id,
        source=RepositorySource(record.source),
        canonical_root=record.canonical_root,
        created_at=created_at,
    )


class SqlAlchemyRepositoryStore:
    """Transaction-scoped repository persistence adapter."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_canonical_root(self, canonical_root: str) -> Repository | None:
        """Find a repository by canonical root."""
        statement = select(RepositoryRecord).where(
            RepositoryRecord.canonical_root == canonical_root
        )
        record = (await self._session.execute(statement)).scalar_one_or_none()
        return _to_domain(record) if record is not None else None

    async def add_local(self, canonical_root: str) -> Repository:
        """Store a local repository and make duplicate registration idempotent."""
        record = RepositoryRecord(
            source=RepositorySource.LOCAL.value, canonical_root=canonical_root
        )
        self._session.add(record)
        try:
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self.get_by_canonical_root(canonical_root)
            if existing is not None:
                return existing
            raise
        await self._session.refresh(record)
        return _to_domain(record)

    async def get(self, repository_id: UUID) -> Repository | None:
        """Find a repository by durable identifier."""
        record = await self._session.get(RepositoryRecord, repository_id)
        return _to_domain(record) if record is not None else None
