"""The deliberately narrow model-provider boundary used by the agent loop."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ModelToolCall:
    """A provider-suggested tool invocation. Arguments remain untrusted data."""

    name: str
    arguments: dict[str, object]


@dataclass(frozen=True, slots=True)
class ModelRequest:
    """Provider input containing only user-visible conversation state."""

    messages: tuple[dict[str, str], ...]


@dataclass(frozen=True, slots=True)
class ModelResponse:
    """Normalized provider output, independent of a vendor SDK."""

    text: str
    tool_calls: tuple[ModelToolCall, ...] = ()


class ModelProvider(Protocol):
    """Async provider contract implemented by real and test model adapters."""

    async def complete(self, request: ModelRequest) -> ModelResponse:
        """Return one response for a bounded model call."""


class FakeModelProvider:
    """Deterministic scripted provider for tests and local development."""

    def __init__(self, responses: Sequence[ModelResponse]) -> None:
        self._responses = tuple(responses)
        self._index = 0
        self.requests: list[ModelRequest] = []

    async def complete(self, request: ModelRequest) -> ModelResponse:
        self.requests.append(request)
        if self._index >= len(self._responses):
            raise AssertionError("FakeModelProvider has no scripted response")
        response = self._responses[self._index]
        self._index += 1
        return response
