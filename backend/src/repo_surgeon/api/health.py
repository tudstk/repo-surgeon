"""Deterministic process-health endpoints."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    """Public response returned by a health endpoint."""

    status: Literal["live", "ready"]


@router.get("/live", response_model=HealthResponse, summary="Check whether the API process is live")
def get_liveness() -> HealthResponse:
    """Return success when the API process can serve HTTP requests."""
    return HealthResponse(status="live")


@router.get("/ready", response_model=HealthResponse, summary="Check whether the API is ready")
def get_readiness() -> HealthResponse:
    """Return success when dependencies required at this milestone are ready."""
    return HealthResponse(status="ready")
