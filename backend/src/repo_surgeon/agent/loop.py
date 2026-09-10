"""A bounded read-only turn over the registered repository file tools."""

from __future__ import annotations

import asyncio
import json
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from pydantic import ValidationError

from repo_surgeon.agent.provider import ModelProvider, ModelRequest, ModelResponse, ModelToolCall
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
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _call_key(call: ModelToolCall) -> str:
    return json.dumps({"name": call.name, "arguments": call.arguments}, sort_keys=True)


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
    messages: list[dict[str, str]] = [{"role": "user", "content": question}]
    events: list[ToolEvent] = []
    repeated: Counter[str] = Counter()
    model_calls = tool_calls = returned_bytes = 0
    answer = ""

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
            response: ModelResponse = await asyncio.wait_for(
                provider.complete(ModelRequest(tuple(messages))), timeout=max(remaining, 0.001)
            )
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

        for call in response.tool_calls:
            if clock() - started >= effective_limits.max_duration_seconds:
                return limited("duration_limit")
            if tool_calls >= effective_limits.max_tool_calls:
                return limited("tool_call_limit")
            key = _call_key(call)
            repeated[key] += 1
            if repeated[key] > effective_limits.max_repeated_tool_calls:
                return limited("repeated_tool_call_limit")
            tool_calls += 1
            result: object
            status: Literal["success", "error", "denied"]
            if call.name not in {"list_files", "read_file"}:
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
                    if call.name == "list_files":
                        result = await tools.list_files(ListFilesInput.model_validate(arguments))
                    else:
                        result = await tools.read_file(ReadFileInput.model_validate(arguments))
                    status = "error" if isinstance(result, ToolErrorOutput) else "success"
                except TypeError, ValidationError:
                    result = _validation_error(call.name)
                    status = "error"
            payload = _serialized(result)
            if returned_bytes + len(payload) > effective_limits.max_returned_bytes:
                return limited("returned_bytes_limit")
            returned_bytes += len(payload)
            events.append(ToolEvent(call.name, status))
            messages.append({"role": "assistant", "content": call.name})
            messages.append({"role": "tool", "content": payload.decode("utf-8")})
