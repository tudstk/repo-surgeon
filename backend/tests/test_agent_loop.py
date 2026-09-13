"""Test-first scenarios for the bounded repository-summary turn."""

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from support import MemoryRepositoryStore

from repo_surgeon.agent import (
    UNTRUSTED_DATA_POLICY,
    AgentLimits,
    FakeModelProvider,
    ModelResponse,
    ModelToolCall,
    run_turn,
)
from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.mcp.file_tools import McpFileTools

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "repos" / "m1-repository-safety"


def tool_client() -> tuple[McpFileTools, object]:
    repository_id = uuid4()
    repository = Repository(
        repository_id, RepositorySource.LOCAL, str(FIXTURE_ROOT), datetime.now(UTC)
    )
    return McpFileTools(MemoryRepositoryStore(repository)), repository_id


@pytest.mark.anyio
async def test_summary_turn_completes_after_safe_reads() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [
            ModelResponse("I am inspecting the repository.", (ModelToolCall("list_files", {}),)),
            ModelResponse(
                "The repository is a small Python project.",
                (ModelToolCall("read_file", {"path": "README.md"}),),
            ),
            ModelResponse("It is a small Python project with bounded file inspection."),
        ]
    )

    result = await run_turn(provider, tools, repository_id, "What does this repository do?")

    assert result.status == "complete"
    assert result.answer.startswith("It is a small Python project")
    assert result.model_calls == 3
    assert [event.status for event in result.events] == ["success", "success"]


@pytest.mark.anyio
async def test_write_requests_are_denied_by_application_code() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [
            ModelResponse(
                "", (ModelToolCall("write_file", {"path": "README.md", "content": "bad"}),)
            ),
            ModelResponse("No write was performed."),
        ]
    )

    result = await run_turn(provider, tools, repository_id, "Summarize")

    assert result.status == "complete"
    assert result.events[0].status == "denied"
    assert result.events[0].name == "write_file"
    assert provider.requests[1].messages[-2]["content"] == "write_file"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("limits", "reason"),
    [
        (AgentLimits(max_model_calls=1), "model_call_limit"),
        (AgentLimits(max_tool_calls=1), "tool_call_limit"),
        (AgentLimits(max_repeated_tool_calls=1), "repeated_tool_call_limit"),
        (AgentLimits(max_returned_bytes=1), "returned_bytes_limit"),
    ],
)
async def test_hard_limits_return_a_partial_result(limits: AgentLimits, reason: str) -> None:
    tools, repository_id = tool_client()
    repeated_call = ModelToolCall("list_files", {})
    provider = FakeModelProvider([ModelResponse("Partial", (repeated_call, repeated_call))])

    result = await run_turn(provider, tools, repository_id, "Summarize", limits)

    assert result.status == "limit_reached"
    assert result.stop_reason == reason
    assert result.answer == "Partial"


@pytest.mark.anyio
async def test_invalid_tool_arguments_become_safe_tool_errors() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [
            ModelResponse("", (ModelToolCall("read_file", {"unexpected": True}),)),
            ModelResponse("Done"),
        ]
    )

    result = await run_turn(provider, tools, repository_id, "Summarize")

    assert result.status == "complete"
    assert result.events[0].status == "error"


@pytest.mark.anyio
async def test_every_provider_request_contains_fixed_untrusted_data_policy() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider([ModelResponse("Done")])

    await run_turn(provider, tools, repository_id, "Summarize")

    assert len(provider.requests) == 1
    assert provider.requests[0].messages[0] == {
        "role": "system",
        "content": UNTRUSTED_DATA_POLICY,
    }


@pytest.mark.anyio
async def test_low_byte_budget_denies_dispatch_before_tool_execution() -> None:
    tools, repository_id = tool_client()
    calls = 0

    async def should_not_run(arguments: object) -> object:
        nonlocal calls
        calls += 1
        return await tools.list_files(arguments)  # type: ignore[arg-type]

    tools.list_files = should_not_run  # type: ignore[method-assign]
    provider = FakeModelProvider([ModelResponse("Partial", (ModelToolCall("list_files", {}),))])

    result = await run_turn(
        provider,
        tools,
        repository_id,
        "Summarize",
        AgentLimits(max_returned_bytes=1),
    )

    assert result.stop_reason == "returned_bytes_limit"
    assert calls == 0


@pytest.mark.anyio
async def test_non_json_tool_arguments_are_deterministic_errors() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [
            ModelResponse("", (ModelToolCall("read_file", {"path": {"bad"}}),)),
            ModelResponse("Done"),
        ]
    )

    result = await run_turn(provider, tools, repository_id, "Summarize")

    assert result.status == "complete"
    assert result.events[0].status == "error"
    assert result.events[0].name == "read_file"


@pytest.mark.anyio
async def test_multiple_opaque_tool_ids_correlate_structured_results() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [
            ModelResponse(
                "Inspecting",
                (
                    ModelToolCall("list_files", {}, "opaque-a"),
                    ModelToolCall("read_file", {"path": "README.md"}, "opaque-b"),
                ),
            ),
            ModelResponse("Done"),
        ]
    )

    result = await run_turn(provider, tools, repository_id, "Summarize")

    assert result.status == "complete"
    assert [event.call_id for event in result.events] == ["opaque-a", "opaque-b"]
    tool_messages = [
        message for message in provider.requests[1].messages if message["role"] == "tool"
    ]
    assert [message["tool_call_id"] for message in tool_messages] == ["opaque-a", "opaque-b"]
    assert all(isinstance(message["content"], dict) for message in tool_messages)


@pytest.mark.anyio
async def test_cancelled_provider_call_propagates_cancellation() -> None:
    tools, repository_id = tool_client()

    class CancelledProvider:
        async def complete(self, request: object) -> ModelResponse:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await run_turn(CancelledProvider(), tools, repository_id, "Summarize")
