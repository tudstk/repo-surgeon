"""A bounded read-only turn over the registered repository file tools."""

from __future__ import annotations

import asyncio
import copy
import json
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from pydantic import ValidationError

from repo_surgeon.agent.provider import (
    UNTRUSTED_DATA_POLICY,
    ModelProvider,
    ModelRequest,
    ModelResponse,
    ModelToolCall,
)
from repo_surgeon.mcp.file_tools import (
    ListFilesInput,
    McpFileTools,
    ReadFileInput,
    ToolErrorOutput,
)


@dataclass(frozen=True, slots=True)
class AgentLimits:
    """Hard limits applied by application code, regardless of provider behavior."""

    max_model_calls: int = 4
    max_tool_calls: int = 12
    max_repeated_tool_calls: int = 2
    max_duration_seconds: float = 10.0
    max_returned_bytes: int = 128 * 1024


@dataclass(frozen=True, slots=True)
class ToolEvent:
    """Safe activity trace entry with no raw repository content."""

    name: str
    status: Literal["success", "error", "denied"]
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class AgentTurn:
    """User-visible result of one bounded turn."""

    status: Literal["complete", "limit_reached"]
    answer: str
    stop_reason: str | None
    model_calls: int
    tool_calls: int
    returned_bytes: int
    events: tuple[ToolEvent, ...]


def _serialized(value: object) -> bytes:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _json_arguments(arguments: object) -> str | None:
    if not isinstance(arguments, dict):
        return None
    try:
        return json.dumps(arguments, allow_nan=False, sort_keys=True, separators=(",", ":"))
    except TypeError, ValueError:
        return None


def _call_key(call: ModelToolCall, serialized_arguments: str | None) -> str:
    if serialized_arguments is None:
        return f"invalid-arguments:{call.name}"
    return json.dumps({"name": call.name, "arguments": serialized_arguments}, sort_keys=True)


def _validation_error(name: str) -> ToolErrorOutput:
    return ToolErrorOutput(code="invalid_tool_arguments", detail=f"Invalid arguments for {name}.")


async def run_turn(
    provider: ModelProvider,
    tools: McpFileTools,
    repository_id: UUID,
    question: str,
    limits: AgentLimits | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> AgentTurn:
    """Run a model turn while keeping all authorization and bounds deterministic."""
    effective_limits = limits or AgentLimits()
    started = clock()
    messages: list[dict[str, object]] = [
        {"role": "system", "content": UNTRUSTED_DATA_POLICY},
        {"role": "user", "content": question},
    ]
    events: list[ToolEvent] = []
    repeated: Counter[str] = Counter()
    model_calls = tool_calls = returned_bytes = 0
    answer = ""
    generated_call_id = 0

    def limited(reason: str) -> AgentTurn:
        return AgentTurn(
            status="limit_reached",
            answer=answer
            or "The repository summary is partial because the turn limit was reached.",
            stop_reason=reason,
            model_calls=model_calls,
            tool_calls=tool_calls,
            returned_bytes=returned_bytes,
            events=tuple(events),
        )

    while True:
        if clock() - started >= effective_limits.max_duration_seconds:
            return limited("duration_limit")
        if model_calls >= effective_limits.max_model_calls:
            return limited("model_call_limit")
        remaining = effective_limits.max_duration_seconds - (clock() - started)
        model_calls += 1
        try:
            copied_messages: list[dict[str, object]] = copy.deepcopy(messages[1:])
            request_messages: tuple[dict[str, object], ...] = tuple(
                [{"role": "system", "content": UNTRUSTED_DATA_POLICY}, *copied_messages]
            )
            try:
                response: ModelResponse = await asyncio.wait_for(
                    provider.complete(ModelRequest(request_messages)), timeout=max(remaining, 0.001)
                )
            except asyncio.CancelledError:
                raise
        except TimeoutError:
            return limited("duration_limit")
        answer = response.text
        if not response.tool_calls:
            return AgentTurn(
                status="complete",
                answer=answer,
                stop_reason=None,
                model_calls=model_calls,
                tool_calls=tool_calls,
                returned_bytes=returned_bytes,
                events=tuple(events),
            )

        response_call_ids: set[str] = set()
        for call in response.tool_calls:
            if clock() - started >= effective_limits.max_duration_seconds:
                return limited("duration_limit")
            if tool_calls >= effective_limits.max_tool_calls:
                return limited("tool_call_limit")
            serialized_arguments = _json_arguments(call.arguments)
            key = _call_key(call, serialized_arguments)
            repeated[key] += 1
            if repeated[key] > effective_limits.max_repeated_tool_calls:
                return limited("repeated_tool_call_limit")
            tool_calls += 1
            generated_call_id += 1
            valid_provider_id = isinstance(call.call_id, str) and len(call.call_id) <= 256
            requested_call_id = call.call_id if valid_provider_id else ""
            duplicate_call_id = bool(requested_call_id) and requested_call_id in response_call_ids
            call_id = requested_call_id if requested_call_id and not duplicate_call_id else ""
            while not call_id or call_id in response_call_ids:
                call_id = f"generated-{generated_call_id}"
                generated_call_id += 1
            response_call_ids.add(call_id)
            result: object
            status: Literal["success", "error", "denied"]
            remaining_bytes = effective_limits.max_returned_bytes - returned_bytes
            minimum_result_bytes = len(_serialized(_validation_error(call.name)))
            if remaining_bytes < minimum_result_bytes:
                return limited("returned_bytes_limit")
            if not valid_provider_id:
                result = ToolErrorOutput(
                    code="invalid_tool_call_id",
                    detail="Tool call IDs must be strings of at most 256 characters.",
                )
                status = "error"
            elif duplicate_call_id:
                result = ToolErrorOutput(
                    code="duplicate_tool_call_id",
                    detail="Tool call IDs must be unique within a provider response.",
                )
                status = "error"
            elif serialized_arguments is None:
                result = _validation_error(call.name)
                status = "error"
            elif call.name not in {"list_files", "read_file"}:
                result = ToolErrorOutput(
                    code="write_operation_denied"
                    if call.name.startswith("write")
                    else "tool_not_allowed",
                    detail="Only list_files and read_file are permitted in a read-only turn.",
                )
                status = "denied"
            else:
                try:
                    arguments = {**call.arguments, "repository_id": repository_id}
                    tool_remaining = effective_limits.max_duration_seconds - (clock() - started)
                    tool_budget = effective_limits.max_returned_bytes - returned_bytes
                    if call.name == "list_files":
                        result = await asyncio.wait_for(
                            tools.list_files(
                                ListFilesInput.model_validate(arguments), max_bytes=tool_budget
                            ),
                            timeout=max(tool_remaining, 0.001),
                        )
                    else:
                        result = await asyncio.wait_for(
                            tools.read_file(
                                ReadFileInput.model_validate(arguments), max_bytes=tool_budget
                            ),
                            timeout=max(tool_remaining, 0.001),
                        )
                    status = "error" if isinstance(result, ToolErrorOutput) else "success"
                except asyncio.CancelledError:
                    raise
                except TimeoutError:
                    return limited("duration_limit")
                except TypeError, ValidationError:
                    result = _validation_error(call.name)
                    status = "error"
            payload = _serialized(result)
            if returned_bytes + len(payload) > effective_limits.max_returned_bytes:
                return limited("returned_bytes_limit")
            returned_bytes += len(payload)
            events.append(ToolEvent(call.name, status, call_id))
            messages.append(
                {
                    "role": "assistant",
                    "content": call.name,
                    "tool_call_id": call_id,
                }
            )
            messages.append(
                {"role": "tool", "tool_call_id": call_id, "content": result.model_dump(mode="json")}
                if hasattr(result, "model_dump")
                else {"role": "tool", "tool_call_id": call_id, "content": result}
            )
