"""SQLAlchemy adapters for identity, opaque sessions, and OAuth transactions."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.application.authentication import GitHubProfile
from repo_surgeon.domain.authentication import (
    GitHubIdentity,
    StoredOAuthTransaction,
    StoredSession,
    User,
    UserStatus,
)
from repo_surgeon.infrastructure.repository_models import (
    AuthSessionRecord,
    GitHubIdentityRecord,
    OAuthTransactionRecord,
    UserRecord,
)


def _utc(value: datetime) -> datetime:
    """Normalize SQLite's naive timestamps to the application's UTC contract."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _user(record: UserRecord) -> User:
    return User(
        id=record.id,
        status=UserStatus(record.status),
        display_name=record.display_name,
        created_at=_utc(record.created_at),
        updated_at=_utc(record.updated_at),
    )


def _identity(record: GitHubIdentityRecord) -> GitHubIdentity:
    return GitHubIdentity(
        id=record.id,
        user_id=record.user_id,
        github_user_id=record.github_user_id,
        github_node_id=record.github_node_id,
        login=record.login,
        avatar_url=record.avatar_url,
        profile_url=record.profile_url,
        created_at=_utc(record.created_at),
        updated_at=_utc(record.updated_at),
    )


def _session(record: AuthSessionRecord, user: UserRecord) -> StoredSession:
    return StoredSession(
        id=record.id,
        user_id=record.user_id,
        user_status=UserStatus(user.status),
        token_digest=record.token_digest,
        csrf_token_digest=record.csrf_token_digest,
        created_at=_utc(record.created_at),
        last_seen_at=_utc(record.last_seen_at),
        expires_at=_utc(record.expires_at),
        absolute_expires_at=_utc(record.absolute_expires_at),
        revoked_at=_utc(record.revoked_at) if record.revoked_at is not None else None,
    )


def _oauth_transaction(record: OAuthTransactionRecord) -> StoredOAuthTransaction:
    return StoredOAuthTransaction(
        id=record.id,
        state_digest=record.state_digest,
        encrypted_pkce_verifier=record.encrypted_pkce_verifier,
        browser_binding_digest=record.browser_binding_digest,
        created_at=_utc(record.created_at),
        expires_at=_utc(record.expires_at),
        consumed_at=_utc(record.consumed_at) if record.consumed_at is not None else None,
    )


class SqlAlchemyUserIdentityStore:
    """Race-safe GitHub identity synchronization with one user per subject."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def synchronize_github_identity(
        self, profile: GitHubProfile
    ) -> tuple[User, GitHubIdentity]:
        """Create a user once or update a pre-existing identity's safe snapshot."""
        existing = await self._find_identity(profile.github_user_id)
        if existing is None:
            try:
                return await self._create_identity(profile)
            except IntegrityError:
                await self._session.rollback()
                existing = await self._find_identity(profile.github_user_id)
                if existing is None:
                    raise
        return await self._update_identity(existing, profile)

    async def _find_identity(self, github_user_id: int) -> GitHubIdentityRecord | None:
        statement = select(GitHubIdentityRecord).where(
            GitHubIdentityRecord.github_user_id == github_user_id
        )
        return (await self._session.execute(statement)).scalar_one_or_none()

    async def _create_identity(self, profile: GitHubProfile) -> tuple[User, GitHubIdentity]:
        user = UserRecord(
            id=uuid4(), status=UserStatus.ACTIVE.value, display_name=profile.display_name
        )
        identity = GitHubIdentityRecord(
            id=uuid4(),
            user_id=user.id,
            github_user_id=profile.github_user_id,
            github_node_id=profile.github_node_id,
            login=profile.login,
            avatar_url=profile.avatar_url,
            profile_url=profile.profile_url,
        )
        self._session.add_all([user, identity])
        await self._session.commit()
        await self._session.refresh(user)
        await self._session.refresh(identity)
        return _user(user), _identity(identity)

    async def _update_identity(
        self, identity: GitHubIdentityRecord, profile: GitHubProfile
    ) -> tuple[User, GitHubIdentity]:
        user = await self._session.get(UserRecord, identity.user_id)
        if user is None:
            raise RuntimeError("GitHub identity references a missing user")
        user.display_name = profile.display_name
        identity.github_node_id = profile.github_node_id
        identity.login = profile.login
        identity.avatar_url = profile.avatar_url
        identity.profile_url = profile.profile_url
        await self._session.commit()
        await self._session.refresh(user)
        await self._session.refresh(identity)
        return _user(user), _identity(identity)


class SqlAlchemySessionStore:
    """Persistence adapter that accepts and queries only SHA-256 token digests."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_session(self, session: StoredSession) -> None:
        """Persist an issued session without access to either raw token value."""
        self._session.add(
            AuthSessionRecord(
                id=session.id,
                user_id=session.user_id,
                token_digest=session.token_digest,
                csrf_token_digest=session.csrf_token_digest,
                created_at=session.created_at,
                last_seen_at=session.last_seen_at,
                expires_at=session.expires_at,
                absolute_expires_at=session.absolute_expires_at,
                revoked_at=session.revoked_at,
            )
        )
        await self._session.commit()

    async def get_by_token_digest(self, token_digest: bytes) -> StoredSession | None:
        """Look up session lifecycle state by digest and include its user status."""
        statement = (
            select(AuthSessionRecord, UserRecord)
            .join(UserRecord, AuthSessionRecord.user_id == UserRecord.id)
            .where(AuthSessionRecord.token_digest == token_digest)
            .execution_options(populate_existing=True)
        )
        row = (await self._session.execute(statement)).one_or_none()
        return _session(*row) if row is not None else None

    async def touch_session(
        self, session_id: UUID, last_seen_at: datetime, expires_at: datetime
    ) -> None:
        """Update sliding expiry without changing the opaque bearer digest."""
        await self._session.execute(
            update(AuthSessionRecord)
            .where(AuthSessionRecord.id == session_id, AuthSessionRecord.revoked_at.is_(None))
            .values(last_seen_at=last_seen_at, expires_at=expires_at)
            .execution_options(synchronize_session=False)
        )
        await self._session.commit()

    async def revoke_by_token_digest(self, token_digest: bytes, revoked_at: datetime) -> bool:
        """Mark a live session revoked and report whether this call changed it."""
        result = await self._session.execute(
            update(AuthSessionRecord)
            .where(
                AuthSessionRecord.token_digest == token_digest,
                AuthSessionRecord.revoked_at.is_(None),
            )
            .values(revoked_at=revoked_at)
            .execution_options(synchronize_session=False)
        )
        await self._session.commit()
        return cast(CursorResult[Any], result).rowcount == 1


class SqlAlchemyOAuthTransactionStore:
    """Database-backed atomic consume operation for OAuth callback state."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_oauth_transaction(self, transaction: StoredOAuthTransaction) -> None:
        """Persist an encrypted verifier and fixed-size secret digests."""
        self._session.add(
            OAuthTransactionRecord(
                id=transaction.id,
                state_digest=transaction.state_digest,
                encrypted_pkce_verifier=transaction.encrypted_pkce_verifier,
                browser_binding_digest=transaction.browser_binding_digest,
                created_at=transaction.created_at,
                expires_at=transaction.expires_at,
                consumed_at=None,
            )
        )
        await self._session.commit()

    async def consume_oauth_transaction(
        self, state_digest: bytes, browser_binding_digest: bytes, consumed_at: datetime
    ) -> StoredOAuthTransaction | None:
        """Set ``consumed_at`` with a single guarded update and return it once."""
        statement = (
            update(OAuthTransactionRecord)
            .where(
                OAuthTransactionRecord.state_digest == state_digest,
                OAuthTransactionRecord.browser_binding_digest == browser_binding_digest,
                OAuthTransactionRecord.consumed_at.is_(None),
                OAuthTransactionRecord.expires_at > consumed_at,
            )
            .values(consumed_at=consumed_at)
            .returning(OAuthTransactionRecord)
            .execution_options(synchronize_session=False)
        )
        record = (await self._session.execute(statement)).scalar_one_or_none()
        await self._session.commit()
        return _oauth_transaction(record) if record is not None else None
