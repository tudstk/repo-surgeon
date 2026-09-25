"""SQLAlchemy mappings for repository persistence."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for application-owned database mappings."""


class UserRecord(Base):
    """Persistence record for a Repo Surgeon tenant."""

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class GitHubIdentityRecord(Base):
    """A GitHub numeric subject and safe mutable profile snapshot."""

    __tablename__ = "github_identities"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    github_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    github_node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    login: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    profile_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AuthSessionRecord(Base):
    """Digest-only opaque application session lifecycle state."""

    __tablename__ = "auth_sessions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    token_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False, unique=True)
    csrf_token_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthTransactionRecord(Base):
    """Single-use OAuth state with encrypted PKCE verifier material."""

    __tablename__ = "oauth_transactions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    state_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False, unique=True)
    encrypted_pkce_verifier: Mapped[str] = mapped_column(Text, nullable=False)
    browser_binding_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RepositoryRecord(Base):
    """Persistence shape deliberately separate from domain and HTTP models."""

    __tablename__ = "repositories"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    canonical_root: Mapped[str] = mapped_column(String(4096), nullable=False)
    root_device: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    root_inode: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "owner_user_id", "source", "canonical_root", name="uq_repositories_owner_source_root"
        ),
    )
