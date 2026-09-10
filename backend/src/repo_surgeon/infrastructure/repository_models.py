"""SQLAlchemy mappings for repository persistence."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for application-owned database mappings."""


class RepositoryRecord(Base):
    """Persistence shape deliberately separate from domain and HTTP models."""

    __tablename__ = "repositories"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    canonical_root: Mapped[str] = mapped_column(String(4096), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
