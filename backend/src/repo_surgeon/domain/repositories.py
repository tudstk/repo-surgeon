"""Repository concepts with no web, database, or filesystem dependencies."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class RepositorySource(StrEnum):
    """The provenance of a registered repository."""

    LOCAL = "local"


@dataclass(frozen=True, slots=True)
class Repository:
    """A repository whose root was approved for bounded read-only access."""

    id: UUID
    source: RepositorySource
    canonical_root: str
    created_at: datetime
