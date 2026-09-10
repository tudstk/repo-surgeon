"""In-process contract tests for bounded, confined MCP file tools."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.mcp.file_tools import (
    ListFilesInput,
    ListFilesOutput,
    McpFileTools,
    ReadFileInput,
    ReadFileOutput,
    ToolErrorOutput,
    tool_audit_summary,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "repos" / "m1-repository-safety"


class MemoryRepositoryStore:
    """Minimal application port fake used by the in-process tool client."""

    def __init__(self, repository: Repository) -> None:
        self._repository = repository

    async def get(self, repository_id: UUID) -> Repository | None:
        return self._repository if repository_id == self._repository.id else None


def tool_client(root: Path = FIXTURE_ROOT) -> tuple[McpFileTools, UUID]:
    """Build an in-process MCP facade over one registered repository capability."""
    identifier = uuid4()
    repository = Repository(
        id=identifier,
        source=RepositorySource.LOCAL,
        canonical_root=str(root.resolve()),
        created_at=datetime.now(UTC),
    )
    return McpFileTools(MemoryRepositoryStore(repository)), identifier


@pytest.mark.anyio
async def test_list_files_and_read_file_return_typed_bounded_results() -> None:
    """A caller can inspect safe files without receiving host paths or raw bytes."""
    client, repository_id = tool_client()

    listing = await client.list_files(
        ListFilesInput(repository_id=repository_id, directory="src", glob="*.py", max_results=999)
    )
    assert isinstance(listing, ListFilesOutput)
    assert listing.entries[0].path == "src/main.py"
    assert len(listing.entries) <= 200

    result = await client.read_file(
        ReadFileInput(repository_id=repository_id, path="docs/many-lines.txt", start_line=1, end_line=999)
    )
    assert isinstance(result, ReadFileOutput)
    assert [line.number for line in result.lines] == list(range(1, 21))
    assert result.truncated is True
    assert len(result.content_sha256) == 64
    assert str(FIXTURE_ROOT) not in result.model_dump_json()
    assert tool_audit_summary(result)["line_count"] == 20


@pytest.mark.anyio
@pytest.mark.parametrize(
    "path",
    [
        "../outside.txt",
        "src/../../outside.txt",
        "/etc/passwd",
        ".git/HEAD",
        ".git/config",
        "link-outside",
        ".env",
        "config/credentials.json",
        "id_rsa",
    ],
)
async def test_attacker_visible_unsafe_paths_have_one_stable_content_free_error(path: str) -> None:
    """Traversal, escaping links, Git internals, and secret paths never disclose bytes."""
    client, repository_id = tool_client()

    result = await client.read_file(ReadFileInput(repository_id=repository_id, path=path))

    assert isinstance(result, ToolErrorOutput)
    assert result.code == "unsafe_path"
    assert "fixture-not-a-real-api-key" not in result.detail
    assert "not-a-real-token" not in result.detail


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "code"), [("binary.dat", "binary_file"), ("oversized.txt", "file_too_large")])
async def test_binary_and_oversized_content_are_denied_before_a_read(path: str, code: str) -> None:
    client, repository_id = tool_client()

    result = await client.read_file(ReadFileInput(repository_id=repository_id, path=path))

    assert isinstance(result, ToolErrorOutput)
    assert result.code == code


@pytest.mark.anyio
async def test_in_root_regular_symlink_is_permitted() -> None:
    client, repository_id = tool_client()

    result = await client.read_file(ReadFileInput(repository_id=repository_id, path="link-inside"))

    assert isinstance(result, ReadFileOutput)
    assert result.path == "link-inside"
    assert any("def greeting" in line.text for line in result.lines)


@pytest.mark.anyio
async def test_real_git_child_is_denied_with_the_stable_unsafe_path_error(tmp_path: Path) -> None:
    """Exercise the Git-internal contract with a real child rather than a fixture trick."""
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    client, repository_id = tool_client(tmp_path)

    result = await client.read_file(ReadFileInput(repository_id=repository_id, path=".git/HEAD"))

    assert isinstance(result, ToolErrorOutput)
    assert result.code == "unsafe_path"


@pytest.mark.anyio
@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="FIFOs are unavailable on this platform")
async def test_special_files_are_denied_without_opening_them(tmp_path: Path) -> None:
    fifo = tmp_path / "named-pipe"
    os.mkfifo(fifo)
    client, repository_id = tool_client(tmp_path)

    result = await client.read_file(ReadFileInput(repository_id=repository_id, path="named-pipe"))

    assert isinstance(result, ToolErrorOutput)
    assert result.code == "unsafe_path"


def test_pydantic_contracts_reject_unknown_fields_and_clamp_valid_bounds() -> None:
    with pytest.raises(ValidationError):
        ListFilesInput(repository_id=uuid4(), unexpected=True)
    assert ListFilesInput(repository_id=uuid4(), max_results=999).max_results == 200
    assert ReadFileInput(repository_id=uuid4(), path="README.md", end_line=999).end_line == 200
