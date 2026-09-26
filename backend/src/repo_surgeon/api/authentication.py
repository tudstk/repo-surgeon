"""FastAPI-owned OAuth and opaque application session endpoints."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from repo_surgeon.application.authentication import (
    OAuthTransactionService,
    SessionService,
    SynchronizeGitHubIdentity,
)
from repo_surgeon.application.github_oauth import GitHubOAuthClient, GitHubOAuthError
from repo_surgeon.domain.authentication import BrowserBinding, CsrfToken, OAuthState, SessionToken
from repo_surgeon.infrastructure.authentication_crypto import FernetPkceVerifierCipher
from repo_surgeon.infrastructure.authentication_store import (
    SqlAlchemyOAuthTransactionStore,
    SqlAlchemySessionStore,
    SqlAlchemyUserIdentityStore,
)
from repo_surgeon.infrastructure.repository_models import GitHubIdentityRecord, UserRecord

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
_CALLBACK_DESTINATION = "/auth/callback"
_LOGIN_ERROR = "/login?error="
_SESSION_COOKIE = "__Host-repo_surgeon_session"
_LOCAL_SESSION_COOKIE = "repo_surgeon_session"
_OAUTH_COOKIE = "__Host-repo_surgeon_oauth"
_LOCAL_OAUTH_COOKIE = "repo_surgeon_oauth"


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Open a request-scoped SQLAlchemy session."""
    async with request.app.state.session_factory() as session:
        yield session


SessionDependency = Annotated[AsyncSession, Depends(get_session)]


def _now() -> datetime:
    return datetime.now(UTC)


def _cookie_name(request: Request, *, oauth: bool = False) -> str:
    settings = request.app.state.settings
    if oauth:
        return _OAUTH_COOKIE if settings.cookie_secure else _LOCAL_OAUTH_COOKIE
    return _SESSION_COOKIE if settings.cookie_secure else _LOCAL_SESSION_COOKIE


def _set_cookie(
    response: Response, request: Request, name: str, value: str, *, max_age: int | None = None
) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path="/",
        secure=request.app.state.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _no_store(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    return response


def _redirect(path: str) -> RedirectResponse:
    response = RedirectResponse(path, status_code=303)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _frontend_redirect(request: Request, path: str) -> RedirectResponse:
    """Redirect to a fixed route on the configured browser origin.

    The OAuth callback may arrive directly at a split-origin API during local
    development. A relative redirect would then resolve against the API origin
    instead of the Next.js origin, so build this fixed destination from the
    validated public origin.
    """
    origin = request.app.state.settings.public_origin.rstrip("/")
    return _redirect(f"{origin}{path}")


def _clear_oauth_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        _cookie_name(request, oauth=True),
        path="/",
        secure=request.app.state.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        _cookie_name(request),
        path="/",
        secure=request.app.state.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _invalid_callback(request: Request) -> RedirectResponse:
    response = _frontend_redirect(request, f"{_LOGIN_ERROR}oauth_state_invalid")
    _clear_oauth_cookie(response, request)
    return response


def _oauth_service(request: Request, session: AsyncSession) -> OAuthTransactionService:
    settings = request.app.state.settings
    return OAuthTransactionService(
        SqlAlchemyOAuthTransactionStore(session),
        FernetPkceVerifierCipher(settings.auth_encryption_key or "local-development-only"),
        ttl=timedelta(seconds=settings.oauth_transaction_ttl_seconds),
    )


def _session_service(request: Request, session: AsyncSession) -> SessionService:
    settings = request.app.state.settings
    return SessionService(
        SqlAlchemySessionStore(session),
        idle_ttl=timedelta(seconds=settings.session_idle_ttl_seconds),
        absolute_ttl=timedelta(seconds=settings.session_absolute_ttl_seconds),
        csrf_secret=(settings.auth_encryption_key or "local-development-csrf-secret").encode(),
    )


def _origin_is_trusted(request: Request) -> bool:
    origin = request.headers.get("Origin")
    if origin is None:
        return False
    settings = request.app.state.settings
    return origin in {settings.public_origin, *settings.csrf_trusted_origins}


@router.get("/github/start")
async def github_start(request: Request, session: SessionDependency) -> Response:
    """Issue a browser-bound one-time OAuth request and redirect to GitHub."""
    created = await _oauth_service(request, session).create(_now())
    challenge = created.pkce_verifier.pkce_s256_challenge()
    query = urlencode(
        {
            "client_id": request.app.state.settings.github_oauth_client_id or "",
            "redirect_uri": request.app.state.settings.oauth_callback_url,
            "state": created.state.reveal_for_transport(),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    response = _redirect(f"https://github.com/login/oauth/authorize?{query}")
    _set_cookie(
        response,
        request,
        _cookie_name(request, oauth=True),
        created.browser_binding.reveal_for_transport(),
        max_age=request.app.state.settings.oauth_transaction_ttl_seconds,
    )
    return response


@router.get("/github/callback")
async def github_callback(
    request: Request,
    session: SessionDependency,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
) -> Response:
    """Consume state before a code exchange and establish a fresh opaque session."""
    binding = request.cookies.get(_cookie_name(request, oauth=True))
    if not state or not binding:
        return _invalid_callback(request)
    try:
        verifier = await _oauth_service(request, session).consume(
            OAuthState(state), BrowserBinding(binding), _now()
        )
    except UnicodeEncodeError, ValueError:
        return _invalid_callback(request)
    if verifier is None:
        return _invalid_callback(request)
    if error == "access_denied":
        response = _frontend_redirect(request, f"{_LOGIN_ERROR}access_denied")
        _clear_oauth_cookie(response, request)
        return response
    if error:
        response = _frontend_redirect(request, f"{_LOGIN_ERROR}oauth_provider_failed")
        _clear_oauth_cookie(response, request)
        return response
    if not code:
        return _invalid_callback(request)
    provider: GitHubOAuthClient = request.app.state.github_oauth_client
    try:
        profile = await provider.authenticate(code, verifier)
        user, _ = await SynchronizeGitHubIdentity(SqlAlchemyUserIdentityStore(session)).execute(
            profile
        )
        previous = request.cookies.get(_cookie_name(request))
        if previous:
            await _session_service(request, session).revoke(SessionToken(previous), _now())
        issued = await _session_service(request, session).issue(user.id, _now())
    except GitHubOAuthError, UnicodeEncodeError, ValueError:
        response = _frontend_redirect(request, f"{_LOGIN_ERROR}oauth_provider_failed")
        _clear_oauth_cookie(response, request)
        return response
    response = _frontend_redirect(request, _CALLBACK_DESTINATION)
    _set_cookie(
        response, request, _cookie_name(request), issued.session_token.reveal_for_transport()
    )
    _clear_oauth_cookie(response, request)
    return response


@router.get("/session")
async def current_session(request: Request, session: SessionDependency) -> Response:
    """Return the safe profile and memory-only CSRF token for the active session."""
    token = request.cookies.get(_cookie_name(request))
    if not token:
        return _no_store(JSONResponse({"detail": "Not authenticated"}, status_code=401))
    try:
        context = await _session_service(request, session).authenticate(SessionToken(token), _now())
    except UnicodeEncodeError, ValueError:
        context = None
    if context is None:
        response = _no_store(JSONResponse({"detail": "Not authenticated"}, status_code=401))
        _clear_session_cookie(response, request)
        return response
    row = (
        await session.execute(
            select(UserRecord, GitHubIdentityRecord)
            .join(GitHubIdentityRecord, GitHubIdentityRecord.user_id == UserRecord.id)
            .where(UserRecord.id == context.user_id)
        )
    ).one_or_none()
    if row is None:
        return _no_store(JSONResponse({"detail": "Not authenticated"}, status_code=401))
    user, identity = row
    csrf_token = _session_service(request, session).csrf_token_for(SessionToken(token))
    # The raw value is not persisted and is returned only after opaque-session authentication.
    return _no_store(
        JSONResponse(
            {
                "user": {
                    "display_name": user.display_name,
                    "github_login": identity.login,
                    "github_avatar_url": identity.avatar_url,
                    "github_profile_url": identity.profile_url,
                },
                "csrf_token": csrf_token.reveal_for_transport(),
            }
        )
    )


@router.post("/logout", status_code=204)
async def logout(request: Request, session: SessionDependency) -> Response:
    """Revoke this browser session after exact Origin and CSRF verification."""
    token = request.cookies.get(_cookie_name(request))
    csrf = request.headers.get("X-CSRF-Token")
    if not _origin_is_trusted(request) or not csrf:
        return _no_store(JSONResponse({"detail": "Forbidden"}, status_code=403))
    if not token:
        response = Response(status_code=204)
        _no_store(response)
        _clear_session_cookie(response, request)
        return response
    try:
        valid = await _session_service(request, session).validates_logout_csrf(
            SessionToken(token), CsrfToken(csrf)
        )
    except UnicodeEncodeError, ValueError:
        valid = False
    if not valid:
        return _no_store(JSONResponse({"detail": "Forbidden"}, status_code=403))
    await _session_service(request, session).revoke(SessionToken(token), _now())
    response = Response(status_code=204)
    _no_store(response)
    _clear_session_cookie(response, request)
    return response
