from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from repo_surgeon.agent.investigation import INVESTIGATION_POLICY, investigate_repository
from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.mcp.file_tools import McpFileTools


class MemoryStore:
    def __init__(self, repository: Repository) -> None:
        identity = Path(repository.canonical_root).stat()
        self.repository = replace(
            repository, root_device=identity.st_dev, root_inode=identity.st_ino
        )

    async def get(self, repository_id: UUID) -> Repository | None:
        return self.repository if repository_id == self.repository.id else None

    async def get_by_canonical_root(self, canonical_root: str) -> Repository | None:
        return self.repository if canonical_root == self.repository.canonical_root else None

    async def list_all(self) -> tuple[Repository, ...]:
        return (self.repository,)

    async def add_local(self, root: ResolvedLocalRepositoryRoot) -> Repository:
        raise AssertionError

    async def bind_legacy_identity(
        self, repository_id: UUID, root: ResolvedLocalRepositoryRoot
    ) -> Repository:
        raise AssertionError


@pytest.mark.anyio
async def test_investigation_ranks_only_retrieved_evidence_and_never_writes(tmp_path: Path) -> None:
    (tmp_path / "session.py").write_text(
        "def expire(token):\n"
        "    # seeded bug: expiry does not remove the session\n"
        "    return token\n"
    )
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))
    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)), repository.id, "Why do users get logged out?"
    )
    assert result.hypotheses
    assert result.hypotheses[0].confidence == "high"
    assert result.hypotheses[0].evidence[0].label.startswith("session.py:")
    assert "read-only" in INVESTIGATION_POLICY.lower()
    assert not (tmp_path / "PWNED").exists()
