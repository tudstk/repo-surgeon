from pydantic import BaseModel, ConfigDict, Field

from repo_surgeon.agent.investigation import InvestigationResult


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
    matched = sum(1 for hypothesis in result.hypotheses if hypothesis.title.casefold() in expected)
    return InvestigationEvaluation(
        accuracy=matched / len(expected) if expected else 0,
        matched_hypotheses=matched,
        expected_hypotheses=len(expected),
        latency_ms=latency_ms,
        cost_usd=cost_usd,
    )
