"""Identity and session concepts with no HTTP or database dependencies."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from hashlib import sha256
from secrets import token_urlsafe
from typing import TypeVar
from uuid import UUID

OpaqueSecretT = TypeVar("OpaqueSecretT", bound="_OpaqueSecret")

LOCAL_DEVELOPMENT_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
"""The only principal used by the trusted local-development workflow."""


class UserStatus(StrEnum):
    """The account states that may authorize an application session."""

    ACTIVE = "active"
    DISABLED = "disabled"


@dataclass(frozen=True, slots=True, repr=False)
class _OpaqueSecret:
    """A high-entropy secret that redacts itself in diagnostics by default."""

    _value: str

    @classmethod
    def generate(cls: type[OpaqueSecretT]) -> OpaqueSecretT:
        """Create a secret with 256 bits of entropy."""
        return cls(token_urlsafe(32))

    @property
    def digest(self) -> bytes:
        """Return the SHA-256 digest suitable for durable persistence."""
        return sha256(self._value.encode("ascii")).digest()

    def reveal_for_transport(self) -> str:
        """Return the value only at the trusted transport boundary."""
        return self._value

    def __repr__(self) -> str:
        return f"{type(self).__name__}(redacted)"


class SessionToken(_OpaqueSecret):
    """An opaque application-session bearer token."""


class CsrfToken(_OpaqueSecret):
    """A per-session token required for unsafe browser requests."""


class OAuthState(_OpaqueSecret):
    """One-time OAuth callback correlation value."""


class BrowserBinding(_OpaqueSecret):
    """Short-lived browser nonce bound to one OAuth transaction."""


@dataclass(frozen=True, slots=True, repr=False)
class PkceVerifier(_OpaqueSecret):
    """PKCE verifier retained only in encrypted short-lived storage."""

    @classmethod
    def generate(cls) -> PkceVerifier:
        """Create a verifier within OAuth's permitted character-length range."""
        return cls(token_urlsafe(64))


@dataclass(frozen=True, slots=True)
class User:
    """A Repo Surgeon tenant, independent of any identity provider."""

    id: UUID
    status: UserStatus
    display_name: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class GitHubIdentity:
    """A stable GitHub subject and its safe, mutable profile snapshot."""

    id: UUID
    user_id: UUID
    github_user_id: int
    github_node_id: str
    login: str
    avatar_url: str | None
    profile_url: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True, repr=False)
class StoredSession:
    """A persisted session projection containing only secret digests."""

    id: UUID
    user_id: UUID
    user_status: UserStatus
    token_digest: bytes = field(repr=False)
    csrf_token_digest: bytes = field(repr=False)
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    absolute_expires_at: datetime
    revoked_at: datetime | None

    def is_valid_at(self, now: datetime) -> bool:
        """Return whether this bearer session remains usable at ``now``."""
        return (
            self.user_status is UserStatus.ACTIVE
            and self.revoked_at is None
            and now < self.expires_at
            and now < self.absolute_expires_at
        )


@dataclass(frozen=True, slots=True)
class AuthContext:
    """The immutable principal capability produced after session validation."""

    user_id: UUID
    session_id: UUID


@dataclass(frozen=True, slots=True, repr=False)
class StoredOAuthTransaction:
    """A one-time OAuth transaction with encrypted, never-logged verifier material."""

    id: UUID
    state_digest: bytes = field(repr=False)
    encrypted_pkce_verifier: str = field(repr=False)
    browser_binding_digest: bytes = field(repr=False)
    created_at: datetime
    expires_at: datetime
    consumed_at: datetime | None
