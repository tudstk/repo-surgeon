"""Record the GitHub identity and revision of imported source snapshots."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261114_0005"
down_revision: str | None = "20260926_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Keep existing local registrations intact."""
    op.add_column("repositories", sa.Column("github_full_name", sa.String(140), nullable=True))
    op.add_column("repositories", sa.Column("github_commit", sa.String(40), nullable=True))


def downgrade() -> None:
    """Require removing imported records before discarding their provenance."""
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT COUNT(*) FROM repositories WHERE source = 'github'")):
        raise RuntimeError("Remove imported GitHub repositories before downgrading.")
    op.drop_column("repositories", "github_commit")
    op.drop_column("repositories", "github_full_name")
