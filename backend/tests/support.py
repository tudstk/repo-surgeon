"""Shared test doubles for application boundary tests."""

from uuid import UUID

from repo_surgeon.application.repositories import RepositoryStore
from repo_surgeon.domain.repositories import Repository


class MemoryRepositoryStore(RepositoryStore):
    def __init__(self, repository: Repository) -> None:
        self._repository = repository

    async def get_by_canonical_root(self, canonical_root: str) -> Repository | None:
        return self._repository if self._repository.canonical_root == canonical_root else None

    async def add_local(self, canonical_root: str) -> Repository:
        raise AssertionError("test store does not register repositories")

    async def get(self, repository_id: UUID) -> Repository | None:
        return self._repository if self._repository.id == repository_id else None
