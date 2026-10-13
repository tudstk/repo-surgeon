"""Shared RFC 9457-style problem details for HTTP boundaries."""

from pydantic import BaseModel


class ProblemDetail(BaseModel):
    """Stable problem response without framework exception internals."""

    type: str
    title: str
    status: int
    detail: str
    code: str


class ApiProblem(Exception):
    """Expected application failure rendered by the shared exception handler."""

    def __init__(self, problem: ProblemDetail) -> None:
        self.problem = problem


def problem(*, code: str, title: str, status: int, detail: str) -> ApiProblem:
    """Build a stable problem response using the application's problem namespace."""
    return ApiProblem(
        ProblemDetail(
            type=f"https://repo-surgeon.local/problems/{code}",
            title=title,
            status=status,
            detail=detail,
            code=code,
        )
    )
