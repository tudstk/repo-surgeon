"""Use cases and ports for registered repositories."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from repo_surgeon.domain.repositories import Repository


@dataclass(frozen=True, slots=True)
class RepositoryRegistrationError(Exception):
    """A deterministic error suitable for an API problem response."""

    code: str
    detail: str


class LocalRepositoryRootResolver(Protocol):
    """Resolve a client-selected local directory into a safe Git worktree root."""

    def resolve(self, candidate: str) -> str:
        """Return the canonical worktree root or raise a registration error."""


class RepositoryStore(Protocol):
    """Persistence boundary for repository identities."""

    async def get_by_canonical_root(self, canonical_root: str) -> Repository | None:
        """Find one repository by its canonical local root."""

    async def add_local(self, canonical_root: str) -> Repository:
        """Persist and return a newly registered local repository."""

    async def get(self, repository_id: UUID) -> Repository | None:
        """Find one repository by its durable identifier."""


class RegisterLocalRepository:
    """Register a local Git worktree once, independent of its input spelling."""

    def __init__(self, resolver: LocalRepositoryRootResolver, store: RepositoryStore) -> None:
        self._resolver = resolver
        self._store = store

    async def execute(self, candidate: str) -> Repository:
        """Validate, canonicalize, and persist a local repository root."""
        canonical_root = self._resolver.resolve(candidate)
        existing = await self._store.get_by_canonical_root(canonical_root)
        if existing is not None:
            return existing
        return await self._store.add_local(canonical_root)


class GetRepository:
    """Retrieve a previously registered repository."""

    def __init__(self, store: RepositoryStore) -> None:
        self._store = store

    async def execute(self, repository_id: UUID) -> Repository | None:
        """Return a repository if its identifier is known."""
        return await self._store.get(repository_id)
