"""Shared test doubles for application boundary tests."""

from dataclasses import replace
from pathlib import Path
from uuid import UUID

from repo_surgeon.application.repositories import RepositoryStore, ResolvedLocalRepositoryRoot
from repo_surgeon.domain.repositories import Repository


class MemoryRepositoryStore(RepositoryStore):
    def __init__(self, repository: Repository) -> None:
        if repository.root_device is None or repository.root_inode is None:
            root_stat = Path(repository.canonical_root).stat()
            repository = replace(
                repository,
                root_device=root_stat.st_dev,
                root_inode=root_stat.st_ino,
            )
        self._repository = repository

    async def get_by_canonical_root(self, canonical_root: str) -> Repository | None:
        return self._repository if self._repository.canonical_root == canonical_root else None

    async def add_local(self, root: ResolvedLocalRepositoryRoot) -> Repository:
        raise AssertionError("test store does not register repositories")

    async def bind_legacy_identity(
        self, repository_id: UUID, root: ResolvedLocalRepositoryRoot
    ) -> Repository:
        raise AssertionError("test store does not bind repository identities")

    async def get(self, repository_id: UUID) -> Repository | None:
        return self._repository if self._repository.id == repository_id else None

    async def list_all(self) -> tuple[Repository, ...]:
        return (self._repository,)
