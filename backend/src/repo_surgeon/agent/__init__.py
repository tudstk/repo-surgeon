"""Bounded, read-only model turn orchestration."""

from repo_surgeon.agent.investigation import (
    Evidence,
    Hypothesis,
    InvestigationResult,
    investigate_repository,
)
from repo_surgeon.agent.loop import AgentLimits, AgentTurn, run_turn
from repo_surgeon.agent.provider import (
    UNTRUSTED_DATA_POLICY,
    FakeModelProvider,
    ModelProvider,
    ModelRequest,
    ModelResponse,
    ModelToolCall,
)

__all__ = [
    "AgentLimits",
    "AgentTurn",
    "FakeModelProvider",
    "ModelProvider",
    "ModelRequest",
    "ModelResponse",
    "ModelToolCall",
    "UNTRUSTED_DATA_POLICY",
    "run_turn",
    "Evidence",
    "Hypothesis",
    "InvestigationResult",
    "investigate_repository",
]
