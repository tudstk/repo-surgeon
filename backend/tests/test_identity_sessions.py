"""Integration coverage for identity, digest-only sessions, and OAuth state storage."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from repo_surgeon.application.authentication import (
    GitHubProfile,
    OAuthTransactionService,
    SessionService,
    SessionStore,
    SynchronizeGitHubIdentity,
)
from repo_surgeon.domain.authentication import (
    LOCAL_DEVELOPMENT_USER_ID,
    BrowserBinding,
    GitHubIdentity,
    StoredSession,
    User,
    UserStatus,
)
from repo_surgeon.infrastructure.authentication_crypto import FernetPkceVerifierCipher
from repo_surgeon.infrastructure.authentication_store import (
    SqlAlchemyOAuthTransactionStore,
    SqlAlchemySessionStore,
    SqlAlchemyUserIdentityStore,
)
from repo_surgeon.infrastructure.database import create_engine as create_async_engine
from repo_surgeon.infrastructure.database import create_session_factory
from repo_surgeon.infrastructure.repository_models import (
    AuthSessionRecord,
    GitHubIdentityRecord,
    OAuthTransactionRecord,
    RepositoryRecord,
    UserRecord,
)


def _profile(github_user_id: int = 101) -> GitHubProfile:
    return GitHubProfile(
        github_user_id=github_user_id,
        github_node_id=f"U_{github_user_id}",
        login=f"surgeon-{github_user_id}",
        display_name=f"Surgeon {github_user_id}",
        avatar_url="https://avatars.example/avatar.png",
        profile_url="https://github.example/surgeon",
    )


async def _upgrade(database_url: str, revision: str = "head") -> None:
    configuration = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    configuration.set_main_option("sqlalchemy.url", database_url)
    await asyncio.to_thread(command.upgrade, configuration, revision)


@pytest.fixture
async def session_factory(tmp_path: Path) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'identity.sqlite3'}"
    await _upgrade(database_url)
    engine = create_async_engine(database_url)
    try:
        yield create_session_factory(engine)
    finally:
        await engine.dispose()


async def _synchronize_user(
    session_factory: async_sessionmaker[AsyncSession], github_user_id: int = 101
) -> tuple[User, GitHubIdentity]:
    async with session_factory() as session:
        return await SynchronizeGitHubIdentity(SqlAlchemyUserIdentityStore(session)).execute(
            _profile(github_user_id)
        )


@pytest.mark.anyio
async def test_session_persists_only_digests_and_enforces_expiry_revocation_and_csrf(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    user, _ = await _synchronize_user(session_factory)
    now = datetime(2026, 9, 23, tzinfo=UTC)
    async with session_factory() as session:
        service = SessionService(
            SqlAlchemySessionStore(session),
            idle_ttl=timedelta(minutes=10),
            absolute_ttl=timedelta(hours=1),
        )
        issued = await service.issue(user.id, now)
        record = (await session.execute(select(AuthSessionRecord))).scalar_one()

        assert record.token_digest == issued.session_token.digest
        assert record.csrf_token_digest == issued.csrf_token.digest
        assert issued.session_token.reveal_for_transport().encode() not in record.token_digest
        assert issued.csrf_token.reveal_for_transport().encode() not in record.csrf_token_digest
        assert "redacted" in repr(issued.session_token)
        assert await service.validates_csrf(issued.session_token, issued.csrf_token, now)
        assert not await service.validates_csrf(
            issued.session_token, type(issued.csrf_token).generate(), now
        )
        assert await service.authenticate(issued.session_token, now + timedelta(minutes=1))
        assert not await service.authenticate(issued.session_token, now + timedelta(minutes=12))
        assert await service.revoke(issued.session_token, now + timedelta(minutes=2))
        assert not await service.revoke(issued.session_token, now + timedelta(minutes=2))
        assert not await service.authenticate(issued.session_token, now + timedelta(minutes=2))


@pytest.mark.anyio
async def test_disabled_user_session_cannot_authenticate(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    user, _ = await _synchronize_user(session_factory)
    now = datetime(2026, 9, 23, tzinfo=UTC)
    async with session_factory() as session:
        service = SessionService(
            SqlAlchemySessionStore(session),
            idle_ttl=timedelta(minutes=10),
            absolute_ttl=timedelta(hours=1),
        )
        issued = await service.issue(user.id, now)
        record = await session.get(UserRecord, user.id)
        assert record is not None
        record.status = UserStatus.DISABLED.value
        await session.commit()
        assert not await service.authenticate(issued.session_token, now + timedelta(minutes=1))


@pytest.mark.anyio
async def test_stale_authentication_cannot_refresh_after_user_is_disabled(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    user, _ = await _synchronize_user(session_factory)
    now = datetime(2026, 9, 23, tzinfo=UTC)
    async with session_factory() as session:
        store = SqlAlchemySessionStore(session)
        issued = await SessionService(
            store, idle_ttl=timedelta(minutes=10), absolute_ttl=timedelta(hours=1)
        ).issue(user.id, now)
        user_record = await session.get(UserRecord, user.id)
        assert user_record is not None
        user_record.status = UserStatus.DISABLED.value
        await session.commit()

        class StaleReadStore:
            async def get_by_token_digest(self, token_digest: bytes) -> StoredSession:
                return issued.session

            async def touch_session(
                self, session_id: UUID, last_seen_at: datetime, expires_at: datetime
            ) -> bool:
                return await store.touch_session(session_id, last_seen_at, expires_at)

        service = SessionService(
            cast(SessionStore, StaleReadStore()),
            idle_ttl=timedelta(minutes=10),
            absolute_ttl=timedelta(hours=1),
        )
        assert await service.authenticate(issued.session_token, now + timedelta(minutes=1)) is None


@pytest.mark.anyio
async def test_session_refresh_does_not_regress_after_a_delayed_request(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    user, _ = await _synchronize_user(session_factory)
    now = datetime(2026, 9, 23, tzinfo=UTC)
    async with session_factory() as session:
        service = SessionService(
            SqlAlchemySessionStore(session),
            idle_ttl=timedelta(minutes=10),
            absolute_ttl=timedelta(hours=1),
        )
        issued = await service.issue(user.id, now)
        store = SqlAlchemySessionStore(session)
        newer_seen = now + timedelta(minutes=2)
        newer_expiry = now + timedelta(minutes=12)
        older_seen = now + timedelta(minutes=1)
        older_expiry = now + timedelta(minutes=11)

        await store.touch_session(issued.session.id, newer_seen, newer_expiry)
        await store.touch_session(issued.session.id, older_seen, older_expiry)

        record = await session.get(AuthSessionRecord, issued.session.id)
        assert record is not None
        assert record.last_seen_at.replace(tzinfo=UTC) == newer_seen
        assert record.expires_at.replace(tzinfo=UTC) == newer_expiry


@pytest.mark.anyio
async def test_authentication_rejects_refresh_when_session_expires_before_persist(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    user, _ = await _synchronize_user(session_factory)
    now = datetime(2026, 9, 23, tzinfo=UTC)
    async with session_factory() as session:
        issued = await SessionService(
            SqlAlchemySessionStore(session),
            idle_ttl=timedelta(minutes=10),
            absolute_ttl=timedelta(hours=1),
        ).issue(user.id, now)

        class ExpiringStore:
            async def get_by_token_digest(self, token_digest: bytes) -> StoredSession:
                return issued.session

            async def touch_session(
                self, session_id: UUID, last_seen_at: datetime, expires_at: datetime
            ) -> bool:
                return False

        service = SessionService(
            cast(SessionStore, ExpiringStore()),
            idle_ttl=timedelta(minutes=10),
            absolute_ttl=timedelta(hours=1),
        )
        assert await service.authenticate(issued.session_token, now + timedelta(minutes=1)) is None


@pytest.mark.anyio
async def test_oauth_transaction_encrypts_verifier_and_consumes_exactly_once(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 9, 23, tzinfo=UTC)
    cipher = FernetPkceVerifierCipher("test encryption key")
    async with session_factory() as session:
        service = OAuthTransactionService(
            SqlAlchemyOAuthTransactionStore(session), cipher, ttl=timedelta(minutes=10)
        )
        created = await service.create(now)
        record = (await session.execute(select(OAuthTransactionRecord))).scalar_one()

        assert record.state_digest == created.state.digest
        assert record.browser_binding_digest == created.browser_binding.digest
        assert created.pkce_verifier.reveal_for_transport() not in record.encrypted_pkce_verifier
        assert (
            await service.consume(
                created.state, BrowserBinding.generate(), now + timedelta(minutes=1)
            )
            is None
        )
        assert (
            await service.consume(
                created.state, created.browser_binding, now + timedelta(minutes=1)
            )
        ) == created.pkce_verifier
        assert (
            await service.consume(
                created.state, created.browser_binding, now + timedelta(minutes=1)
            )
        ) is None


@pytest.mark.anyio
async def test_expired_oauth_transaction_cannot_be_consumed(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 9, 23, tzinfo=UTC)
    async with session_factory() as session:
        service = OAuthTransactionService(
            SqlAlchemyOAuthTransactionStore(session),
            FernetPkceVerifierCipher("test encryption key"),
            ttl=timedelta(minutes=10),
        )
        created = await service.create(now)
        assert (
            await service.consume(
                created.state, created.browser_binding, now + timedelta(minutes=10)
            )
        ) is None


@pytest.mark.anyio
async def test_identity_uniqueness_race_creates_one_identity_and_one_user(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def synchronize() -> tuple[User, GitHubIdentity]:
        async with session_factory() as session:
            return await SynchronizeGitHubIdentity(SqlAlchemyUserIdentityStore(session)).execute(
                _profile(777)
            )

    first, second = await asyncio.gather(synchronize(), synchronize())
    assert first[0].id == second[0].id
    async with session_factory() as session:
        identities = (await session.execute(select(GitHubIdentityRecord))).scalars().all()
        users = (await session.execute(select(UserRecord))).scalars().all()
    assert len(identities) == 1
    assert len(users) == 2  # The reserved local principal plus the GitHub tenant.
    assert identities[0].user_id == first[0].id


@pytest.mark.anyio
async def test_migration_backfills_legacy_repositories_and_scopes_root_identity(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    async_database_url = f"sqlite+aiosqlite:///{database_path}"
    await _upgrade(async_database_url, "20260916_0002")
    sync_engine = create_engine(f"sqlite:///{database_path}")
    legacy_id = uuid4()
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                """
            INSERT INTO repositories (id, source, canonical_root, root_device, root_inode)
            VALUES (:id, 'local', '/legacy/repository', 1, 2)
            """
            ),
            {"id": legacy_id.hex},
        )
    sync_engine.dispose()

    await _upgrade(async_database_url)
    engine = create_async_engine(async_database_url)
    session_factory = create_session_factory(engine)
    try:
        async with session_factory() as session:
            legacy = await session.get(RepositoryRecord, legacy_id)
            local_principal = await session.get(UserRecord, LOCAL_DEVELOPMENT_USER_ID)
            assert legacy is not None
            assert legacy.owner_user_id == LOCAL_DEVELOPMENT_USER_ID
            assert local_principal is not None

            other_user = UserRecord(
                id=uuid4(), status=UserStatus.ACTIVE.value, display_name="Other tenant"
            )
            session.add(other_user)
            await session.flush()
            session.add(
                RepositoryRecord(
                    id=uuid4(),
                    owner_user_id=other_user.id,
                    source="local",
                    canonical_root="/legacy/repository",
                    root_device=3,
                    root_inode=4,
                )
            )
            await session.commit()
    finally:
        await engine.dispose()

    configuration = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    configuration.set_main_option("sqlalchemy.url", async_database_url)
    with pytest.raises(RuntimeError, match="multiple repositories share a canonical root"):
        await asyncio.to_thread(command.downgrade, configuration, "20260916_0002")
