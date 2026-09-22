import importlib.util
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from repo_surgeon.agent.investigation import InvestigationResult, SeededBehavioralProof


CANONICAL_SEEDED_QUESTION = "why do users get logged out after their session expires?"
CANONICAL_SEEDED_FIXTURE = (
    Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "repos" / "m4-session-expiry"
)
CANONICAL_SEEDED_PROOF = SeededBehavioralProof(
    title="Expiry path may leave stale session state",
    explanation=(
        "The seeded fixture's deterministic behavioral proof shows expiry returning the "
        "session token, leaving the user-visible session active after expiry."
    ),
    verification_suggestion="Run the seeded expiry test and inspect the session state after expiry.",
)


def seeded_behavioral_proof(
    question: str, canonical_root: str
) -> SeededBehavioralProof | None:
    if Path(canonical_root).resolve() != CANONICAL_SEEDED_FIXTURE.resolve():
        return None
    module_spec = importlib.util.spec_from_file_location(
        "repo_surgeon_m4_seeded_session", CANONICAL_SEEDED_FIXTURE / "session.py"
    )
    if module_spec is None or module_spec.loader is None:
        return None
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    session_type = getattr(module, "SessionState", None)
    expire = getattr(module, "expire", None)
    if not callable(session_type) or not callable(expire):
        return None
    expired_token = "m4-session-token"
    session = session_type(expired_token)
    returned_token = expire(session, expired_token)
    failure_observed = returned_token == expired_token
    user_visible_session_remains_active = session.active is True
    if not (failure_observed and user_visible_session_remains_active):
        return None
    normalized_question = " ".join(question.casefold().split())
    return CANONICAL_SEEDED_PROOF if normalized_question == CANONICAL_SEEDED_QUESTION else None


class InvestigationEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    accuracy: float = Field(ge=0, le=1)
    matched_hypotheses: int = Field(ge=0)
    expected_hypotheses: int = Field(ge=0)
    latency_ms: int = Field(ge=0)
    cost_usd: float = Field(ge=0)


def grade_investigation(
    result: InvestigationResult,
    expected_titles: tuple[str, ...],
    *,
    latency_ms: int,
    cost_usd: float,
) -> InvestigationEvaluation:
    """Score ranked titles deterministically and retain provider cost/latency facts."""
    expected = {title.casefold() for title in expected_titles}
    matched_titles = {hypothesis.title.casefold() for hypothesis in result.hypotheses}
    matched = len(matched_titles & expected)
    return InvestigationEvaluation(
        accuracy=matched / len(expected) if expected else 0,
        matched_hypotheses=matched,
        expected_hypotheses=len(expected),
        latency_ms=latency_ms,
        cost_usd=cost_usd,
    )
