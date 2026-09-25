"""Add tenant identity, opaque sessions, and OAuth transaction persistence.

Revision ID: 20260923_0003
Revises: 20260916_0002
Create Date: 2026-09-23 00:00:00.000000
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_0003"
down_revision: str | None = "20260916_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCAL_DEVELOPMENT_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


def _create_users_table() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("status", sa.String()),
        sa.column("display_name", sa.String()),
    )
    op.bulk_insert(
        users,
        [
            {
                "id": LOCAL_DEVELOPMENT_USER_ID,
                "status": "active",
                "display_name": "Local development",
            }
        ],
    )


def _replace_repositories_with_owner_scope() -> None:
    """Rebuild to remove the historical unnamed global root unique constraint."""
    op.create_table(
        "repositories_replacement",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("canonical_root", sa.String(length=4096), nullable=False),
        sa.Column("root_device", sa.BigInteger(), nullable=True),
        sa.Column("root_inode", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_user_id", "source", "canonical_root", name="uq_repositories_owner_source_root"
        ),
    )
    statement = sa.text(
        """
        INSERT INTO repositories_replacement (
            id, owner_user_id, source, canonical_root, root_device, root_inode, created_at
        )
        SELECT id, :owner_user_id, source, canonical_root, root_device, root_inode, created_at
        FROM repositories
        """
    ).bindparams(sa.bindparam("owner_user_id", value=LOCAL_DEVELOPMENT_USER_ID, type_=sa.Uuid()))
    op.execute(statement)
    op.drop_table("repositories")
    op.rename_table("repositories_replacement", "repositories")


def upgrade() -> None:
    """Persist one tenant owner for every repository and auth lifecycle record."""
    _create_users_table()
    _replace_repositories_with_owner_scope()
    op.create_table(
        "github_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("github_user_id", sa.BigInteger(), nullable=False),
        sa.Column("github_node_id", sa.String(length=255), nullable=False),
        sa.Column("login", sa.String(length=255), nullable=False),
        sa.Column("avatar_url", sa.String(length=2048), nullable=True),
        sa.Column("profile_url", sa.String(length=2048), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
        sa.UniqueConstraint("github_user_id"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.LargeBinary(length=32), nullable=False),
        sa.Column("csrf_token_digest", sa.LargeBinary(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"], unique=False)
    op.create_table(
        "oauth_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state_digest", sa.LargeBinary(length=32), nullable=False),
        sa.Column("encrypted_pkce_verifier", sa.Text(), nullable=False),
        sa.Column("browser_binding_digest", sa.LargeBinary(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_digest"),
    )
    op.create_index(
        "ix_oauth_transactions_expires_at", "oauth_transactions", ["expires_at"], unique=False
    )


def downgrade() -> None:
    """Restore the pre-identity schema when owner-scoped rows remain globally unique."""
    collision = (
        op.get_bind()
        .execute(
            sa.text(
                """
            SELECT canonical_root
            FROM repositories
            GROUP BY canonical_root
            HAVING COUNT(*) > 1
            LIMIT 1
            """
            )
        )
        .first()
    )
    if collision is not None:
        raise RuntimeError(
            "Cannot downgrade identity migration: multiple repositories share a canonical root"
        )
    op.drop_index("ix_oauth_transactions_expires_at", table_name="oauth_transactions")
    op.drop_table("oauth_transactions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("github_identities")
    op.create_table(
        "repositories_legacy",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("canonical_root", sa.String(length=4096), nullable=False),
        sa.Column("root_device", sa.BigInteger(), nullable=True),
        sa.Column("root_inode", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("canonical_root"),
    )
    op.execute(
        """
        INSERT INTO repositories_legacy (
            id, source, canonical_root, root_device, root_inode, created_at
        )
        SELECT id, source, canonical_root, root_device, root_inode, created_at FROM repositories
        """
    )
    op.drop_table("repositories")
    op.rename_table("repositories_legacy", "repositories")
    op.drop_table("users")
