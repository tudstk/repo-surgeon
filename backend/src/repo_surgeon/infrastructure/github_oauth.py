"""HTTPX implementation of the identity-only GitHub OAuth client port."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import httpx

from repo_surgeon.application.authentication import GitHubProfile
from repo_surgeon.application.github_oauth import GitHubOAuthError
from repo_surgeon.domain.authentication import PkceVerifier
from repo_surgeon.settings import Settings

_TOKEN_URL = "https://github.com/login/oauth/access_token"
_USER_URL = "https://api.github.com/user"
_API_VERSION = "2022-11-28"


class HttpxGitHubOAuthClient:
    """Use an OAuth token only in process while retrieving one GitHub profile."""

    def __init__(self, settings: Settings, *, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.AsyncClient(timeout=10.0, follow_redirects=False)
        self._owns_client = client is None

    async def aclose(self) -> None:
        """Close the internally-owned HTTP client during application shutdown."""
        if self._owns_client:
            await self._client.aclose()

    async def authenticate(self, code: str, verifier: PkceVerifier) -> GitHubProfile:
        """Exchange a code then obtain exactly one authenticated user profile."""
        try:
            token_response = await self._client.post(
                _TOKEN_URL,
                data={
                    "client_id": self._settings.github_oauth_client_id,
                    "client_secret": self._settings.github_oauth_client_secret,
                    "code": code,
                    "redirect_uri": self._settings.oauth_callback_url,
                    "code_verifier": verifier.reveal_for_transport(),
                },
                headers={"Accept": "application/json"},
            )
            token_response.raise_for_status()
            payload = token_response.json()
            token = payload.get("access_token") if isinstance(payload, dict) else None
            if not isinstance(token, str) or not token:
                raise GitHubOAuthError
            user_response = await self._client.get(
                _USER_URL,
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Bearer {token}",
                    "X-GitHub-Api-Version": _API_VERSION,
                },
            )
            user_response.raise_for_status()
            return _profile_from_payload(user_response.json())
        except (httpx.HTTPError, ValueError, TypeError, GitHubOAuthError) as error:
            if isinstance(error, GitHubOAuthError):
                raise
            raise GitHubOAuthError from error


def _optional_https_url(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 2048:
        raise GitHubOAuthError
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise GitHubOAuthError
    return value


def _required_text(payload: dict[str, Any], key: str, maximum: int = 255) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise GitHubOAuthError
    return value


def _profile_from_payload(payload: object) -> GitHubProfile:
    """Project GitHub's response to the small safe identity contract."""
    if not isinstance(payload, dict) or payload.get("type") != "User":
        raise GitHubOAuthError
    github_user_id = payload.get("id")
    if (
        isinstance(github_user_id, bool)
        or not isinstance(github_user_id, int)
        or github_user_id < 1
    ):
        raise GitHubOAuthError
    login = _required_text(payload, "login")
    name = payload.get("name")
    display_name = name.strip() if isinstance(name, str) and name.strip() else login
    if len(display_name) > 255:
        raise GitHubOAuthError
    return GitHubProfile(
        github_user_id=github_user_id,
        github_node_id=_required_text(payload, "node_id"),
        login=login,
        display_name=display_name,
        avatar_url=_optional_https_url(payload.get("avatar_url")),
        profile_url=_optional_https_url(payload.get("html_url")),
    )
