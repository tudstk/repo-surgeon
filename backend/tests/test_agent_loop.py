"""Test-first scenarios for the bounded repository-summary turn."""

import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from threading import Event as ThreadEvent
from threading import Lock
from uuid import UUID, uuid4

import pytest
from support import MemoryRepositoryStore

from repo_surgeon.agent import (
    UNTRUSTED_DATA_POLICY,
    AgentLimits,
    FakeModelProvider,
    ModelRequest,
    ModelResponse,
    ModelToolCall,
    run_turn,
)
from repo_surgeon.application.repository_files import ConfinedRepositoryFiles
from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.mcp.file_tools import (
    MIN_TOOL_RESULT_BYTES,
    FileEntryOutput,
    ListFilesInput,
    ListFilesOutput,
    McpFileTools,
    ReadFileInput,
    ReadFileOutput,
    ToolErrorOutput,
    returned_bytes_limit_error,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "repos" / "m1-repository-safety"


def tool_client() -> tuple[McpFileTools, UUID]:
    repository_id = uuid4()
    repository = Repository(
        repository_id, RepositorySource.LOCAL, str(FIXTURE_ROOT), datetime.now(UTC)
    )
    return McpFileTools(MemoryRepositoryStore(repository)), repository_id


def serialized_size(value: object) -> int:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return len(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


async def wait_for_thread_event(event: ThreadEvent) -> None:
    async with asyncio.timeout(1):
        while not event.is_set():
            await asyncio.sleep(0.001)


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
    before = (FIXTURE_ROOT / "README.md").read_bytes()
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
    assert (FIXTURE_ROOT / "README.md").read_bytes() == before


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

    async def should_not_run(
        arguments: ListFilesInput, max_bytes: int | None = None
    ) -> ListFilesOutput | ToolErrorOutput | None:
        nonlocal calls
        calls += 1
        return await McpFileTools.list_files(tools, arguments)

    tools.list_files = should_not_run  # type: ignore[method-assign]
    provider = FakeModelProvider(
        [ModelResponse("Partial", (ModelToolCall("list_files", {}),)), ModelResponse("Done")]
    )

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
async def test_over_budget_tool_result_is_not_returned_to_provider() -> None:
    tools, repository_id = tool_client()
    completed = False

    async def oversized_tool(
        arguments: ListFilesInput, max_bytes: int | None = None
    ) -> ListFilesOutput | ToolErrorOutput:
        nonlocal completed
        if max_bytes is not None and max_bytes < 512:
            return ToolErrorOutput(
                code="returned_bytes_limit",
                detail="The tool result exceeds the budget.",
            )
        completed = True
        return ListFilesOutput(
            directory=".",
            entries=tuple(
                FileEntryOutput(path=f"file-{index}.txt", entry_type="file", size_bytes=1)
                for index in range(100)
            ),
            truncated=False,
        )

    tools.list_files = oversized_tool  # type: ignore[method-assign]
    provider = FakeModelProvider(
        [ModelResponse("Partial", (ModelToolCall("list_files", {}),)), ModelResponse("Done")]
    )
    result = await run_turn(
        provider, tools, repository_id, "Summarize", AgentLimits(max_returned_bytes=100)
    )

    assert not completed
    assert result.status == "complete"
    assert result.returned_bytes > 0
    assert provider.requests[1].messages[-1]["content"]["code"] == "returned_bytes_limit"  # type: ignore[index]


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
@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
async def test_non_standard_json_numbers_are_rejected(value: float) -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [ModelResponse("", (ModelToolCall("read_file", {"path": value}),)), ModelResponse("Done")]
    )

    result = await run_turn(provider, tools, repository_id, "Summarize")

    assert result.status == "complete"
    assert result.events[0].status == "error"
    assert provider.requests[1].messages[-1]["content"]["code"] == "invalid_tool_arguments"  # type: ignore[index]


@pytest.mark.anyio
async def test_policy_is_reconstructed_after_provider_mutates_request() -> None:
    tools, repository_id = tool_client()

    class MutatingProvider:
        def __init__(self) -> None:
            self.requests: list[ModelRequest] = []
            self.index = 0

        async def complete(self, request: ModelRequest) -> ModelResponse:
            self.requests.append(request)
            if self.index == 0:
                request.messages[0]["content"] = "hostile mutation"
            self.index += 1
            if self.index == 1:
                return ModelResponse("Inspecting", (ModelToolCall("list_files", {}),))
            return ModelResponse("Finished")

    provider = MutatingProvider()
    await run_turn(provider, tools, repository_id, "Summarize")

    assert provider.requests[1].messages[0]["content"] == UNTRUSTED_DATA_POLICY


@pytest.mark.anyio
async def test_duplicate_provider_ids_are_rejected() -> None:
    tools, repository_id = tool_client()
    provider = FakeModelProvider(
        [
            ModelResponse(
                "Inspecting",
                (
                    ModelToolCall("list_files", {}, "same-id"),
                    ModelToolCall("read_file", {"path": "README.md"}, "same-id"),
                ),
            ),
            ModelResponse("Done"),
        ]
    )

    result = await run_turn(provider, tools, repository_id, "Summarize")

    assert result.status == "complete"
    assert [event.status for event in result.events] == ["success", "error"]
    assert provider.requests[1].messages[-1]["content"]["code"] == "duplicate_tool_call_id"  # type: ignore[index]


@pytest.mark.anyio
async def test_slow_tool_is_cancelled_at_turn_deadline() -> None:
    tools, repository_id = tool_client()
    started = asyncio.Event()

    async def slow_tool(
        arguments: ListFilesInput, max_bytes: int | None = None
    ) -> ListFilesOutput | ToolErrorOutput | None:
        started.set()
        await asyncio.sleep(1)
        return await McpFileTools.list_files(tools, arguments)

    tools.list_files = slow_tool  # type: ignore[method-assign]
    provider = FakeModelProvider([ModelResponse("Partial", (ModelToolCall("list_files", {}),))])
    result = await run_turn(
        provider, tools, repository_id, "Summarize", AgentLimits(max_duration_seconds=0.01)
    )

    assert started.is_set()
    assert result.stop_reason == "duration_limit"


@pytest.mark.anyio
async def test_active_tool_cancellation_propagates() -> None:
    tools, repository_id = tool_client()
    active = asyncio.Event()

    async def cancellable_tool(
        arguments: ListFilesInput, max_bytes: int | None = None
    ) -> ListFilesOutput | ToolErrorOutput | None:
        active.set()
        await asyncio.sleep(1)
        return await McpFileTools.list_files(tools, arguments)

    tools.list_files = cancellable_tool  # type: ignore[method-assign]
    provider = FakeModelProvider([ModelResponse("Partial", (ModelToolCall("list_files", {}),))])
    task = asyncio.create_task(run_turn(provider, tools, repository_id, "Summarize"))
    await active.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


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


@pytest.mark.anyio
async def test_real_tool_results_fit_exact_remaining_byte_budget() -> None:
    tools, repository_id = tool_client()
    list_result = await tools.list_files(ListFilesInput(repository_id=repository_id))
    assert isinstance(list_result, ListFilesOutput)
    list_size = len(json.dumps(list_result.model_dump(mode="json"), separators=(",", ":")).encode())
    bounded_list = await tools.list_files(
        ListFilesInput(repository_id=repository_id), max_bytes=list_size
    )
    assert isinstance(bounded_list, ListFilesOutput)
    assert (
        len(json.dumps(bounded_list.model_dump(mode="json"), separators=(",", ":")).encode())
        <= list_size
    )

    read_result = await tools.read_file(
        ReadFileInput(repository_id=repository_id, path="README.md")
    )
    assert isinstance(read_result, ReadFileOutput)
    read_size = len(json.dumps(read_result.model_dump(mode="json"), separators=(",", ":")).encode())
    bounded_read = await tools.read_file(
        ReadFileInput(repository_id=repository_id, path="README.md"), max_bytes=read_size
    )
    assert isinstance(bounded_read, ReadFileOutput)
    assert (
        len(json.dumps(bounded_read.model_dump(mode="json"), separators=(",", ":")).encode())
        <= read_size
    )


@pytest.mark.anyio
async def test_tool_error_envelopes_have_exact_below_at_above_boundaries() -> None:
    tools, repository_id = tool_client()
    missing_repository_id = uuid4()
    assert serialized_size(returned_bytes_limit_error()) == MIN_TOOL_RESULT_BYTES

    list_arguments = ListFilesInput(repository_id=missing_repository_id)
    assert await tools.list_files(list_arguments, max_bytes=MIN_TOOL_RESULT_BYTES - 1) is None
    for budget in (MIN_TOOL_RESULT_BYTES, MIN_TOOL_RESULT_BYTES + 1):
        list_result = await tools.list_files(list_arguments, max_bytes=budget)
        assert isinstance(list_result, ToolErrorOutput)
        assert list_result.code == "returned_bytes_limit"
        assert serialized_size(list_result) <= budget

    read_arguments = ReadFileInput(repository_id=missing_repository_id, path="README.md")
    assert await tools.read_file(read_arguments, max_bytes=MIN_TOOL_RESULT_BYTES - 1) is None
    for budget in (MIN_TOOL_RESULT_BYTES, MIN_TOOL_RESULT_BYTES + 1):
        read_result = await tools.read_file(read_arguments, max_bytes=budget)
        assert isinstance(read_result, ToolErrorOutput)
        assert read_result.code == "returned_bytes_limit"
        assert serialized_size(read_result) <= budget


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tool_name", "arguments"),
    [("list_files", {}), ("read_file", {"path": "README.md"})],
)
@pytest.mark.parametrize("budget_offset", [-1, 0, 1])
async def test_run_turn_enforces_exact_result_envelope_boundary(
    tool_name: str, arguments: dict[str, object], budget_offset: int
) -> None:
    tools, repository_id = tool_client()
    budget = MIN_TOOL_RESULT_BYTES + budget_offset
    responses = [ModelResponse("Partial", (ModelToolCall(tool_name, arguments),))]
    if budget_offset >= 0:
        responses.append(ModelResponse("Done"))
    provider = FakeModelProvider(responses)

    result = await run_turn(
        provider,
        tools,
        repository_id,
        "Summarize",
        AgentLimits(max_returned_bytes=budget),
    )

    if budget_offset < 0:
        assert result.stop_reason == "returned_bytes_limit"
        assert result.returned_bytes == 0
        assert len(provider.requests) == 1
    else:
        assert result.status == "complete"
        assert 0 < result.returned_bytes <= budget
        assert len(provider.requests) == 2
        assert serialized_size(provider.requests[1].messages[-1]["content"]) <= budget


@pytest.mark.anyio
async def test_blocking_filesystem_work_does_not_block_turn_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools, repository_id = tool_client()
    original_list = ConfinedRepositoryFiles.list_files
    worker_started = ThreadEvent()
    release_worker = ThreadEvent()
    worker_finished = ThreadEvent()

    def blocked_list(*args: object, **kwargs: object) -> object:
        worker_started.set()
        release_worker.wait(timeout=1)
        try:
            return original_list(ConfinedRepositoryFiles(str(FIXTURE_ROOT)))
        finally:
            worker_finished.set()

    monkeypatch.setattr(ConfinedRepositoryFiles, "list_files", blocked_list)
    provider = FakeModelProvider([ModelResponse("Partial", (ModelToolCall("list_files", {}),))])
    started = time.monotonic()
    try:
        result = await run_turn(
            provider, tools, repository_id, "Summarize", AgentLimits(max_duration_seconds=0.01)
        )

        assert result.stop_reason == "duration_limit"
        assert time.monotonic() - started < 0.1
        assert worker_started.is_set()
        assert not worker_finished.is_set()
    finally:
        release_worker.set()
        await wait_for_thread_event(worker_finished)


@pytest.mark.anyio
async def test_repeated_blocking_timeouts_use_one_bounded_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active = 0
    peak = 0
    started = 0
    completed = 0
    counter_lock = Lock()
    release_worker = ThreadEvent()
    worker_finished = ThreadEvent()
    original_list = ConfinedRepositoryFiles.list_files

    def blocked_list(*args: object, **kwargs: object) -> object:
        nonlocal active, peak, started, completed
        with counter_lock:
            active += 1
            started += 1
            peak = max(peak, active)
        release_worker.wait(timeout=1)
        try:
            return original_list(ConfinedRepositoryFiles(str(FIXTURE_ROOT)))
        finally:
            with counter_lock:
                active -= 1
                completed += 1
            worker_finished.set()

    monkeypatch.setattr(ConfinedRepositoryFiles, "list_files", blocked_list)
    try:
        for _ in range(3):
            tools, repository_id = tool_client()
            provider = FakeModelProvider(
                [ModelResponse("Partial", (ModelToolCall("list_files", {}),))]
            )
            result = await run_turn(
                provider,
                tools,
                repository_id,
                "Summarize",
                AgentLimits(max_duration_seconds=0.005),
            )
            assert result.stop_reason == "duration_limit"

        with counter_lock:
            assert active == 1
            assert started == 1
            assert completed == 0
            assert peak == 1
    finally:
        release_worker.set()
        await wait_for_thread_event(worker_finished)

    with counter_lock:
        assert active == 0
        assert started == completed == 1
        assert peak == 1
