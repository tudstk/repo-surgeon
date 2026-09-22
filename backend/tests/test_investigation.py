from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from repo_surgeon.agent.investigation import investigate_repository
from repo_surgeon.agent.loop import AgentLimits
from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.evaluation.bug_investigation import seeded_behavioral_proof
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
        "    return token\n"
    )
    (tmp_path / "test_session.py").write_text(
        "def test_expired_session_is_rejected():\n"
        "    assert expire('token') is None\n"
    )
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))
    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)), repository.id, "Why do users get logged out?"
    )
    assert result.hypotheses
    assert result.hypotheses[0].confidence == "low"
    assert result.hypotheses[0].evidence[0].label.startswith("session.py:")
    assert result.tool_calls == 1
    assert (tmp_path / "session.py").read_text() == (
        "def expire(token):\n"
        "    return token\n"
    )


@pytest.mark.anyio
async def test_unvalidated_keyword_evidence_does_not_create_a_hypothesis(tmp_path: Path) -> None:
    source = tmp_path / "unrelated.py"
    source.write_text("def expire(token):\n    return revoke(token)\n")
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))

    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)), repository.id, "Why do users get logged out?"
    )

    assert result.hypotheses == ()
    assert result.tool_calls == 1
    assert source.read_text() == "def expire(token):\n    return revoke(token)\n"


@pytest.mark.anyio
async def test_canonical_question_requires_behavioral_proof(tmp_path: Path) -> None:
    fixture_root = Path(__file__).parent / "fixtures" / "repos" / "m4-session-expiry"
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(fixture_root), datetime.now(UTC))
    question = "Why  do users get logged out after their session expires? "

    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)),
        repository.id,
        question,
        seeded_proof=seeded_behavioral_proof(question, repository.canonical_root),
    )

    assert result.hypotheses[0].title == "Expiry path may leave stale session state"
    assert result.hypotheses[0].confidence == "medium"
    assert "def expire" in result.hypotheses[0].evidence[0].excerpt
    assert "return token" in result.hypotheses[0].evidence[0].excerpt


@pytest.mark.anyio
async def test_unsupported_question_returns_insufficient_evidence(tmp_path: Path) -> None:
    (tmp_path / "session.py").write_text("def expire(token):\n    return token\n")
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))

    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)), repository.id, "Why is the database connection slow?"
    )

    assert result.hypotheses == ()
    assert result.tool_calls == 0


@pytest.mark.anyio
async def test_keyword_overlap_does_not_select_expiry_plan(tmp_path: Path) -> None:
    (tmp_path / "session.py").write_text("def expire(token):\n    return token\n")
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))

    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)), repository.id, "Why is session storage slow?"
    )

    assert result.hypotheses == ()
    assert result.tool_calls == 0


@pytest.mark.anyio
async def test_investigation_stops_at_returned_byte_budget(tmp_path: Path) -> None:
    (tmp_path / "session.py").write_text("def expire(token):\n    return token\n")
    repository = Repository(uuid4(), RepositorySource.LOCAL, str(tmp_path), datetime.now(UTC))

    result = await investigate_repository(
        McpFileTools(MemoryStore(repository)),
        repository.id,
        "Why do users get logged out?",
        AgentLimits(max_model_calls=1, max_tool_calls=4, max_returned_bytes=1),
    )

    assert result.status == "partial"
    assert result.stop_reason == "returned_bytes_limit"
    assert result.returned_bytes <= 1
