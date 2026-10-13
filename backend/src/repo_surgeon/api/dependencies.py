"""Reusable database, principal, and browser-mutation dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hmac import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.api.problems import problem
from repo_surgeon.application.authentication import SessionService
from repo_surgeon.domain.authentication import (
    LOCAL_DEVELOPMENT_USER_ID,
    CsrfToken,
    SessionToken,
)
from repo_surgeon.infrastructure.authentication_store import SqlAlchemySessionStore


@dataclass(frozen=True, slots=True)
class RequestPrincipal:
    """The tenant capability authorized for one HTTP request."""

    user_id: UUID
    auth_session_id: UUID | None


async def get_database_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Open one request-scoped SQLAlchemy session."""
    async with request.app.state.session_factory() as session:
        yield session


DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]


def session_cookie_name(request: Request) -> str:
    """Return the configured opaque session cookie name."""
    return (
        "__Host-repo_surgeon_session"
        if request.app.state.settings.cookie_secure
        else "repo_surgeon_session"
    )


def session_service(request: Request, database: AsyncSession) -> SessionService:
    """Build the application session service from validated settings."""
    settings = request.app.state.settings
    return SessionService(
        SqlAlchemySessionStore(database),
        idle_ttl=timedelta(seconds=settings.session_idle_ttl_seconds),
        absolute_ttl=timedelta(seconds=settings.session_absolute_ttl_seconds),
        csrf_secret=(settings.auth_encryption_key or "local-development-csrf-secret").encode(),
    )


async def current_principal(request: Request, database: DatabaseSession) -> RequestPrincipal:
    """Resolve the local principal or authenticate the public opaque session."""
    if request.app.state.settings.access_mode == "local_trusted":
        return RequestPrincipal(LOCAL_DEVELOPMENT_USER_ID, None)

    raw_token = request.cookies.get(session_cookie_name(request))
    if not raw_token:
        raise problem(
            code="authentication_required",
            title="Authentication required",
            status=401,
            detail="An authenticated application session is required.",
        )
    try:
        context = await session_service(request, database).authenticate(
            SessionToken(raw_token), datetime.now(UTC)
        )
    except UnicodeEncodeError, ValueError:
        context = None
    if context is None:
        raise problem(
            code="authentication_required",
            title="Authentication required",
            status=401,
            detail="An authenticated application session is required.",
        )
    return RequestPrincipal(context.user_id, context.session_id)


CurrentPrincipal = Annotated[RequestPrincipal, Depends(current_principal)]


async def mutation_principal(request: Request, database: DatabaseSession) -> RequestPrincipal:
    """Authorize a tenant mutation with exact Origin and per-session CSRF in public mode."""
    principal = await current_principal(request, database)
    if request.app.state.settings.access_mode == "local_trusted":
        return principal

    settings = request.app.state.settings
    origin = request.headers.get("Origin")
    trusted_origins = {settings.public_origin, *settings.csrf_trusted_origins}
    raw_token = request.cookies.get(session_cookie_name(request))
    supplied_csrf = request.headers.get("X-CSRF-Token")
    valid_csrf = False
    if raw_token and supplied_csrf:
        try:
            expected = session_service(request, database).csrf_token_for(SessionToken(raw_token))
            valid_csrf = compare_digest(expected.digest, CsrfToken(supplied_csrf).digest)
        except UnicodeEncodeError, ValueError:
            valid_csrf = False
    if origin not in trusted_origins or not valid_csrf:
        raise problem(
            code="request_forbidden",
            title="Request forbidden",
            status=403,
            detail="The request Origin and CSRF token must match the authenticated session.",
        )
    return principal


MutationPrincipal = Annotated[RequestPrincipal, Depends(mutation_principal)]
