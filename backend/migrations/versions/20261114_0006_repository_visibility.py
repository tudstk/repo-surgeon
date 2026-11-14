"""Keep repository removal reversible without deleting session history."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261114_0006"
down_revision: str | None = "20261114_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "repositories", sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.false())
    )


def downgrade() -> None:
    op.drop_column("repositories", "hidden")
