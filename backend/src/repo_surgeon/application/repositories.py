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


@dataclass(frozen=True, slots=True)
class ResolvedLocalRepositoryRoot:
    """A canonical root and the filesystem identity approved at registration."""

    canonical_root: str
    root_device: int
    root_inode: int


class LocalRepositoryRootResolver(Protocol):
    """Resolve a client-selected local directory into a safe Git worktree root."""

    def resolve(self, candidate: str) -> ResolvedLocalRepositoryRoot:
        """Return the canonical worktree root and its stable filesystem identity."""


class RepositoryLookup(Protocol):
    """Read-only repository lookup needed by repository-bound tools."""

    async def get(self, repository_id: UUID) -> Repository | None:
        """Find one repository by its durable identifier."""


class RepositoryStore(RepositoryLookup, Protocol):
    """Persistence boundary for repository identities."""

    async def get_by_canonical_root(self, canonical_root: str) -> Repository | None:
        """Find one repository by its canonical local root."""

    async def add_local(self, root: ResolvedLocalRepositoryRoot) -> Repository:
        """Persist and return a newly registered local repository."""

    async def bind_legacy_identity(
        self, repository_id: UUID, root: ResolvedLocalRepositoryRoot
    ) -> Repository:
        """Bind an explicitly re-registered legacy row to its current root identity."""

    async def list_all(self) -> tuple[Repository, ...]:
        """Return all registered repositories in stable order."""


class RegisterLocalRepository:
    """Register a local Git worktree once, independent of its input spelling."""

    def __init__(self, resolver: LocalRepositoryRootResolver, store: RepositoryStore) -> None:
        self._resolver = resolver
        self._store = store

    async def execute(self, candidate: str) -> Repository:
        """Validate, canonicalize, and persist a local repository root."""
        root = self._resolver.resolve(candidate)
        existing = await self._store.get_by_canonical_root(root.canonical_root)
        if existing is not None:
            if existing.root_device is None or existing.root_inode is None:
                return await self._store.bind_legacy_identity(existing.id, root)
            if (existing.root_device, existing.root_inode) != (
                root.root_device,
                root.root_inode,
            ):
                raise RepositoryRegistrationError(
                    code="repository_identity_changed",
                    detail="The registered repository path now identifies a different directory.",
                )
            return existing
        return await self._store.add_local(root)


class GetRepository:
    """Retrieve a previously registered repository."""

    def __init__(self, store: RepositoryStore) -> None:
        self._store = store

    async def execute(self, repository_id: UUID) -> Repository | None:
        """Return a repository if its identifier is known."""
        return await self._store.get(repository_id)


class ListRepositories:
    """List registered repositories for client-side repository selection."""

    def __init__(self, store: RepositoryStore) -> None:
        self._store = store

    async def execute(self) -> tuple[Repository, ...]:
        """Return all registered repository capabilities."""
        return await self._store.list_all()
