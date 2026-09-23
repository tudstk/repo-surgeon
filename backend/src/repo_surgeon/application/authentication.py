"""Typed application services and persistence ports for identity and sessions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from hmac import compare_digest
from typing import Protocol
from uuid import UUID

from repo_surgeon.domain.authentication import (
    AuthContext,
    BrowserBinding,
    CsrfToken,
    GitHubIdentity,
    OAuthState,
    PkceVerifier,
    SessionToken,
    StoredOAuthTransaction,
    StoredSession,
    User,
    UserStatus,
)


@dataclass(frozen=True, slots=True)
class GitHubProfile:
    """The safe identity fields supplied by the future GitHub client port."""

    github_user_id: int
    github_node_id: str
    login: str
    display_name: str
    avatar_url: str | None
    profile_url: str | None


class UserIdentityStore(Protocol):
    """Persist and synchronize an external identity without exposing ORM details."""

    async def synchronize_github_identity(
        self, profile: GitHubProfile
    ) -> tuple[User, GitHubIdentity]:
        """Create or update the single user associated with this stable GitHub subject."""


class SessionStore(Protocol):
    """Durable lifecycle operations for opaque application sessions."""

    async def create_session(self, session: StoredSession) -> None:
        """Persist a newly issued session using digests only."""

    async def get_by_token_digest(self, token_digest: bytes) -> StoredSession | None:
        """Find a session without ever querying by a raw bearer token."""

    async def touch_session(
        self, session_id: UUID, last_seen_at: datetime, expires_at: datetime
    ) -> bool:
        """Persist the bounded sliding-expiry update for a valid session."""

    async def revoke_by_token_digest(self, token_digest: bytes, revoked_at: datetime) -> bool:
        """Revoke the matching session idempotently."""


class OAuthTransactionStore(Protocol):
    """Persistence boundary for browser-bound, single-use OAuth transactions."""

    async def create_oauth_transaction(self, transaction: StoredOAuthTransaction) -> None:
        """Persist digests and encrypted verifier storage for a new transaction."""

    async def consume_oauth_transaction(
        self,
        state_digest: bytes,
        browser_binding_digest: bytes,
        consumed_at: datetime,
    ) -> StoredOAuthTransaction | None:
        """Atomically consume one unexpired transaction or return no transaction."""


class PkceVerifierCipher(Protocol):
    """Encrypt and decrypt PKCE verifier material at the infrastructure boundary."""

    def encrypt(self, verifier: PkceVerifier) -> str:
        """Encrypt a verifier before persistence."""

    def decrypt(self, encrypted_verifier: str) -> PkceVerifier:
        """Decrypt a verifier only after an atomic successful consume."""


class SynchronizeGitHubIdentity:
    """Synchronize a safe GitHub profile snapshot to one tenant identity."""

    def __init__(self, store: UserIdentityStore) -> None:
        self._store = store

    async def execute(self, profile: GitHubProfile) -> tuple[User, GitHubIdentity]:
        """Create or refresh the identity selected by GitHub's immutable numeric ID."""
        return await self._store.synchronize_github_identity(profile)


@dataclass(frozen=True, slots=True, repr=False)
class IssuedSession:
    """The only point where raw session and CSRF values coexist."""

    session: StoredSession
    session_token: SessionToken
    csrf_token: CsrfToken


class SessionService:
    """Issue, validate, refresh, and revoke digest-only application sessions."""

    def __init__(
        self,
        store: SessionStore,
        *,
        idle_ttl: timedelta,
        absolute_ttl: timedelta,
    ) -> None:
        self._store = store
        self._idle_ttl = idle_ttl
        self._absolute_ttl = absolute_ttl

    async def issue(self, user_id: UUID, now: datetime) -> IssuedSession:
        """Create a fresh token pair and bounded session lifecycle record."""
        from uuid import uuid4

        token = SessionToken.generate()
        csrf_token = CsrfToken.generate()
        absolute_expires_at = now + self._absolute_ttl
        session = StoredSession(
            id=uuid4(),
            user_id=user_id,
            user_status=UserStatus.ACTIVE,
            token_digest=token.digest,
            csrf_token_digest=csrf_token.digest,
            created_at=now,
            last_seen_at=now,
            expires_at=min(now + self._idle_ttl, absolute_expires_at),
            absolute_expires_at=absolute_expires_at,
            revoked_at=None,
        )
        await self._store.create_session(session)
        return IssuedSession(session=session, session_token=token, csrf_token=csrf_token)

    async def authenticate(self, token: SessionToken, now: datetime) -> AuthContext | None:
        """Authenticate an opaque token and refresh its bounded idle expiry."""
        session = await self._store.get_by_token_digest(token.digest)
        if session is None or not session.is_valid_at(now):
            return None
        expires_at = min(now + self._idle_ttl, session.absolute_expires_at)
        if not await self._store.touch_session(session.id, now, expires_at):
            return None
        return AuthContext(user_id=session.user_id, session_id=session.id)

    async def revoke(self, token: SessionToken, now: datetime) -> bool:
        """Revoke the current session without distinguishing absent and prior revocation."""
        return await self._store.revoke_by_token_digest(token.digest, now)

    async def validates_csrf(
        self, token: SessionToken, csrf_token: CsrfToken, now: datetime
    ) -> bool:
        """Validate a CSRF token only for an otherwise valid session."""
        session = await self._store.get_by_token_digest(token.digest)
        return (
            session is not None
            and session.is_valid_at(now)
            and compare_digest(session.csrf_token_digest, csrf_token.digest)
        )


@dataclass(frozen=True, slots=True, repr=False)
class CreatedOAuthTransaction:
    """The redirect-facing secrets generated for one OAuth authorization request."""

    state: OAuthState
    browser_binding: BrowserBinding
    pkce_verifier: PkceVerifier
    transaction: StoredOAuthTransaction


class OAuthTransactionService:
    """Create and atomically consume short-lived browser-bound OAuth state."""

    def __init__(
        self,
        store: OAuthTransactionStore,
        cipher: PkceVerifierCipher,
        *,
        ttl: timedelta,
    ) -> None:
        self._store = store
        self._cipher = cipher
        self._ttl = ttl

    async def create(self, now: datetime) -> CreatedOAuthTransaction:
        """Generate state, browser binding, and PKCE verifier for a future redirect."""
        from uuid import uuid4

        state = OAuthState.generate()
        binding = BrowserBinding.generate()
        verifier = PkceVerifier.generate()
        transaction = StoredOAuthTransaction(
            id=uuid4(),
            state_digest=state.digest,
            encrypted_pkce_verifier=self._cipher.encrypt(verifier),
            browser_binding_digest=binding.digest,
            created_at=now,
            expires_at=now + self._ttl,
            consumed_at=None,
        )
        await self._store.create_oauth_transaction(transaction)
        return CreatedOAuthTransaction(
            state=state,
            browser_binding=binding,
            pkce_verifier=verifier,
            transaction=transaction,
        )

    async def consume(
        self, state: OAuthState, browser_binding: BrowserBinding, now: datetime
    ) -> PkceVerifier | None:
        """Return the verifier once, only after atomic state and binding validation."""
        transaction = await self._store.consume_oauth_transaction(
            state.digest, browser_binding.digest, now
        )
        if transaction is None:
            return None
        return self._cipher.decrypt(transaction.encrypted_pkce_verifier)
