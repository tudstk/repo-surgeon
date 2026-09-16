"""SQLAlchemy adapter for registered repositories."""

from datetime import UTC
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.application.repositories import (
    RepositoryRegistrationError,
    ResolvedLocalRepositoryRoot,
)
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
        root_device=record.root_device,
        root_inode=record.root_inode,
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

    async def add_local(self, root: ResolvedLocalRepositoryRoot) -> Repository:
        """Store a local repository and make duplicate registration idempotent."""
        record = RepositoryRecord(
            source=RepositorySource.LOCAL.value,
            canonical_root=root.canonical_root,
            root_device=root.root_device,
            root_inode=root.root_inode,
        )
        self._session.add(record)
        try:
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self.get_by_canonical_root(root.canonical_root)
            if existing is not None:
                if (existing.root_device, existing.root_inode) != (
                    root.root_device,
                    root.root_inode,
                ):
                    raise RepositoryRegistrationError(
                        code="repository_identity_changed",
                        detail=(
                            "The registered repository path now identifies a different directory."
                        ),
                    ) from None
                return existing
            raise
        await self._session.refresh(record)
        return _to_domain(record)

    async def bind_legacy_identity(
        self, repository_id: UUID, root: ResolvedLocalRepositoryRoot
    ) -> Repository:
        """Bind a legacy row only after the user explicitly re-registers its path."""
        record = await self._session.get(RepositoryRecord, repository_id)
        if record is None:
            raise LookupError("repository disappeared while binding its root identity")
        record.root_device = root.root_device
        record.root_inode = root.root_inode
        await self._session.commit()
        await self._session.refresh(record)
        return _to_domain(record)

    async def get(self, repository_id: UUID) -> Repository | None:
        """Find a repository by durable identifier."""
        record = await self._session.get(RepositoryRecord, repository_id)
        return _to_domain(record) if record is not None else None

    async def list_all(self) -> tuple[Repository, ...]:
        """Return registered repositories in creation order."""
        statement = select(RepositoryRecord).order_by(
            RepositoryRecord.created_at, RepositoryRecord.id
        )
        records = (await self._session.execute(statement)).scalars().all()
        return tuple(_to_domain(record) for record in records)
