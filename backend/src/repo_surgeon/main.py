"""ASGI application factory and default application instance."""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from ipaddress import ip_address

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from repo_surgeon.api.authentication import router as authentication_router
from repo_surgeon.api.health import router as health_router
from repo_surgeon.api.repositories import ProblemDetail, RepositoryProblem
from repo_surgeon.api.repositories import router as repositories_router
from repo_surgeon.infrastructure.database import create_engine, create_session_factory
from repo_surgeon.infrastructure.github_oauth import HttpxGitHubOAuthClient
from repo_surgeon.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create a configured FastAPI application with request-scoped persistence."""
    configured_settings = settings or get_settings()
    engine = create_engine(configured_settings.database_url)

    github_oauth_client = HttpxGitHubOAuthClient(configured_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await github_oauth_client.aclose()
        await engine.dispose()

    app = FastAPI(title=configured_settings.app_name, version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def loopback_only(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        client = request.client
        if (
            configured_settings.access_mode == "local_trusted"
            and client is not None
            and client.host
        ):
            try:
                is_loopback = ip_address(client.host).is_loopback
            except ValueError:
                is_loopback = False
            if not is_loopback:
                return JSONResponse(
                    status_code=403,
                    content={
                        "type": "https://repo-surgeon.local/problems/local_only",
                        "title": "Local access required",
                        "status": 403,
                        "detail": "This development API accepts loopback connections only.",
                        "code": "local_only",
                    },
                    media_type="application/problem+json",
                )
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )
    if configured_settings.environment == "production":
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=configured_settings.allowed_hosts)

    @app.exception_handler(RepositoryProblem)
    async def repository_problem_handler(_: Request, error: RepositoryProblem) -> JSONResponse:
        """Render expected registration failures without framework-specific wrapping."""
        return JSONResponse(
            status_code=error.problem.status,
            content=error.problem.model_dump(mode="json"),
            media_type="application/problem+json",
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(_: Request, __: RequestValidationError) -> JSONResponse:
        """Keep repository request validation failures in the public problem format."""
        problem = ProblemDetail(
            type="https://repo-surgeon.local/problems/request_validation_failed",
            title="Request validation failed",
            status=422,
            detail="Request data does not match the required API contract.",
            code="request_validation_failed",
        )
        return JSONResponse(
            status_code=problem.status,
            content=problem.model_dump(mode="json"),
            media_type="application/problem+json",
        )

    app.state.engine = engine
    app.state.settings = configured_settings
    app.state.session_factory = create_session_factory(engine)
    app.state.github_oauth_client = github_oauth_client
    app.include_router(health_router)
    app.include_router(authentication_router)
    app.include_router(repositories_router)
    return app


app = create_app()
