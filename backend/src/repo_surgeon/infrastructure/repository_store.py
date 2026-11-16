"""SQLAlchemy adapter for registered repositories."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.application.repositories import (
    RepositoryRegistrationError,
    ResolvedLocalRepositoryRoot,
)
from repo_surgeon.domain.authentication import LOCAL_DEVELOPMENT_USER_ID
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
        owner_user_id=record.owner_user_id,
        github_full_name=record.github_full_name,
        github_commit=record.github_commit,
    )


class SqlAlchemyRepositoryStore:
    """Transaction-scoped repository persistence adapter."""

    def __init__(
        self, session: AsyncSession, owner_user_id: UUID = LOCAL_DEVELOPMENT_USER_ID
    ) -> None:
        self._session = session
        self._owner_user_id = owner_user_id

    async def get_by_canonical_root(
        self, canonical_root: str, source: RepositorySource = RepositorySource.LOCAL
    ) -> Repository | None:
        """Find a repository by canonical root."""
        statement = select(RepositoryRecord).where(
            RepositoryRecord.owner_user_id == self._owner_user_id,
            RepositoryRecord.source == source.value,
            RepositoryRecord.canonical_root == canonical_root,
        )
        record = (await self._session.execute(statement)).scalar_one_or_none()
        return _to_domain(record) if record is not None else None

    async def add_local(self, root: ResolvedLocalRepositoryRoot) -> Repository:
        """Store a local repository and make duplicate registration idempotent."""
        return await self._add(root, RepositorySource.LOCAL)

    async def add_github(
        self, root: ResolvedLocalRepositoryRoot, full_name: str, commit: str
    ) -> Repository:
        """Persist one tenant's immutable GitHub source snapshot."""
        return await self._add(root, RepositorySource.GITHUB, full_name, commit)

    async def _add(
        self,
        root: ResolvedLocalRepositoryRoot,
        source: RepositorySource,
        full_name: str | None = None,
        commit: str | None = None,
    ) -> Repository:
        record = RepositoryRecord(
            owner_user_id=self._owner_user_id,
            source=source.value,
            github_full_name=full_name,
            github_commit=commit,
            canonical_root=root.canonical_root,
            root_device=root.root_device,
            root_inode=root.root_inode,
        )
        if source == RepositorySource.GITHUB:
            # Keep successive snapshot registrations ordered even within the same second.
            record.created_at = datetime.now(UTC)
        self._session.add(record)
        try:
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self.get_by_canonical_root(root.canonical_root, source)
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
                await self.set_hidden(existing.id, False)
                return existing
            raise
        await self._session.refresh(record)
        return _to_domain(record)

    async def recover_github_device(
        self, repository: Repository, verified: ResolvedLocalRepositoryRoot
    ) -> bool:
        """Update only the device binding of the verified, still-current snapshot."""
        if (
            repository.source != RepositorySource.GITHUB
            or repository.canonical_root != verified.canonical_root
            or repository.root_inode != verified.root_inode
        ):
            return False
        result = await self._session.execute(
            update(RepositoryRecord)
            .where(
                RepositoryRecord.id == repository.id,
                RepositoryRecord.owner_user_id == self._owner_user_id,
                RepositoryRecord.source == RepositorySource.GITHUB.value,
                RepositoryRecord.canonical_root == verified.canonical_root,
                RepositoryRecord.root_inode == verified.root_inode,
                RepositoryRecord.root_device == repository.root_device,
                RepositoryRecord.github_full_name == repository.github_full_name,
                RepositoryRecord.github_commit == repository.github_commit,
            )
            .values(root_device=verified.root_device)
            .returning(RepositoryRecord.id)
        )
        updated = result.scalar_one_or_none() is not None
        await self._session.commit()
        return updated

    async def bind_legacy_identity(
        self, repository_id: UUID, root: ResolvedLocalRepositoryRoot
    ) -> Repository:
        """Bind a legacy row only after the user explicitly re-registers its path."""
        record = await self._session.get(RepositoryRecord, repository_id)
        if record is not None and record.owner_user_id != self._owner_user_id:
            record = None
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
        if record is not None and record.owner_user_id != self._owner_user_id:
            record = None
        return _to_domain(record) if record is not None else None

    async def set_hidden(self, repository_id: UUID, hidden: bool) -> bool:
        """Change list visibility without deleting snapshots or sessions."""
        record = await self._session.get(RepositoryRecord, repository_id)
        if record is None or record.owner_user_id != self._owner_user_id:
            return False
        record.hidden = hidden
        await self._session.commit()
        return True

    async def list_all(self) -> tuple[Repository, ...]:
        """Return registered repositories in creation order."""
        statement = (
            select(RepositoryRecord)
            .order_by(RepositoryRecord.created_at, RepositoryRecord.id)
            .where(RepositoryRecord.hidden.is_(False))
            .where(RepositoryRecord.owner_user_id == self._owner_user_id)
        )
        records = (await self._session.execute(statement)).scalars().all()
        return tuple(_to_domain(record) for record in records)
