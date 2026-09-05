"""Public HTTP tests for process-health behavior."""

import httpx
import pytest
from pytest import MonkeyPatch

from repo_surgeon.main import create_app
from repo_surgeon.settings import Settings


@pytest.mark.anyio
async def test_liveness_endpoint_reports_live_status() -> None:
    """The liveness endpoint is available through the ASGI HTTP boundary."""
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "live"}


@pytest.mark.anyio
async def test_readiness_endpoint_reports_ready_status() -> None:
    """Readiness remains deterministic before persistence is introduced."""
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_settings_read_the_configured_environment(monkeypatch: MonkeyPatch) -> None:
    """Settings use the documented project-specific environment prefix."""
    monkeypatch.setenv("REPO_SURGEON_ENVIRONMENT", "test")

    settings = Settings()

    assert settings.environment == "test"
