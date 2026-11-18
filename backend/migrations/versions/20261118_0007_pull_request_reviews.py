"""Attach pinned review context and retry identity to saved agent runs."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261118_0007"
down_revision: str | None = "20261114_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("review_context", sa.JSON(), nullable=True))
    op.add_column("agent_runs", sa.Column("review_request_id", sa.Uuid(), nullable=True))
    op.create_index(
        "uq_agent_runs_owner_review_request",
        "agent_runs",
        ["owner_user_id", "review_request_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_agent_runs_owner_review_request", table_name="agent_runs")
    op.drop_column("agent_runs", "review_request_id")
    op.drop_column("agent_runs", "review_context")
