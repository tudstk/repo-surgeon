"""Store the filesystem identity established during repository registration.

Revision ID: 20260916_0002
Revises: 20260909_0001
Create Date: 2026-09-16 06:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_0002"
down_revision: str | None = "20260909_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable identity columns for new and explicitly re-registered roots."""
    with op.batch_alter_table("repositories") as batch_op:
        batch_op.add_column(sa.Column("root_device", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("root_inode", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    """Remove persisted root identity fields."""
    with op.batch_alter_table("repositories") as batch_op:
        batch_op.drop_column("root_inode")
        batch_op.drop_column("root_device")
