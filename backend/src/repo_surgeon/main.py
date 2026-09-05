"""ASGI application factory and default application instance."""

from fastapi import FastAPI

from repo_surgeon.api.health import router as health_router
from repo_surgeon.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create a configured FastAPI application without external dependencies."""
    configured_settings = settings or get_settings()
    app = FastAPI(title=configured_settings.app_name, version="0.1.0")
    app.include_router(health_router)
    return app


app = create_app()
