"""ASGI application factory and default application instance."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from repo_surgeon.api.health import router as health_router
from repo_surgeon.api.repositories import RepositoryProblem
from repo_surgeon.api.repositories import router as repositories_router
from repo_surgeon.infrastructure.database import create_engine, create_session_factory
from repo_surgeon.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create a configured FastAPI application with request-scoped persistence."""
    configured_settings = settings or get_settings()
    engine = create_engine(configured_settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await engine.dispose()

    app = FastAPI(title=configured_settings.app_name, version="0.1.0", lifespan=lifespan)

    @app.exception_handler(RepositoryProblem)
    async def repository_problem_handler(_: Request, error: RepositoryProblem) -> JSONResponse:
        """Render expected registration failures without framework-specific wrapping."""
        return JSONResponse(
            status_code=error.problem.status,
            content=error.problem.model_dump(mode="json"),
            media_type="application/problem+json",
        )

    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.include_router(health_router)
    app.include_router(repositories_router)
    return app


app = create_app()
