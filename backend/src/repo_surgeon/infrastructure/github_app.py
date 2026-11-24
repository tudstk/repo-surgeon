"""Short-lived GitHub App tokens scoped to a single local repository."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import stat
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from repo_surgeon.settings import GitHubAppSettings

GITHUB_API_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


GitHubReadPermission = Literal["contents", "pull_requests"]


class GitHubAppError(Exception):
    """A credential failure safe to show without the upstream response."""


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _load_key(path: Path) -> rsa.RSAPrivateKey:
    try:
        descriptor = os.open(path.expanduser(), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as pem:
            info = os.fstat(pem.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid()
                or info.st_mode & 0o077
                or info.st_size > 32_768
            ):
                raise ValueError
            key = serialization.load_pem_private_key(pem.read(32_769), password=None)
        if not isinstance(key, rsa.RSAPrivateKey):
            raise ValueError
        return key
    except OSError, ValueError, TypeError:
        raise GitHubAppError(
            "The GitHub App private key must be a readable, owner-only RSA PEM file."
        ) from None


class _SignedArchiveLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not ("https://codeload.github.com/" in message and "?" in message)


class GitHubAppInstallation:
    """Mint single-permission tokens for the configured numeric repository ID."""

    def __init__(self, settings: GitHubAppSettings) -> None:
        self._app_id = settings.app_id
        self._installation_id = settings.installation_id
        self.repository_id = settings.repository_id
        self._key = _load_key(settings.private_key_path)
        self._lock = asyncio.Lock()
        self._tokens: dict[tuple[str, str], tuple[str, datetime]] = {}
        # httpx logs full URLs at INFO. Private archive redirects carry a temporary token.
        logger = logging.getLogger("httpx")
        if not any(isinstance(item, _SignedArchiveLogFilter) for item in logger.filters):
            logger.addFilter(_SignedArchiveLogFilter())

    def _jwt(self, now: datetime) -> str:
        epoch = int(now.timestamp())
        claims = {"iss": str(self._app_id), "iat": epoch - 60, "exp": epoch + 8 * 60}
        header = _base64url(b'{"alg":"RS256","typ":"JWT"}')
        payload = _base64url(json.dumps(claims, separators=(",", ":")).encode("ascii"))
        signed = f"{header}.{payload}"
        signature = self._key.sign(signed.encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
        return f"{signed}.{_base64url(signature)}"

    async def access_token(
        self, client: httpx.AsyncClient, *, permission: GitHubReadPermission = "contents"
    ) -> str:
        return await self._mint(client, permission, "read")

    async def fix_publication_token(self, client: httpx.AsyncClient) -> str:
        """Used only by the standalone approved-fix publisher."""
        return await self._mint(client, "contents", "write")

    async def fix_comment_token(self, client: httpx.AsyncClient) -> str:
        """The bot uses this token only to reply in the PR conversation."""
        return await self._mint(client, "issues", "write")

    async def _mint(
        self,
        client: httpx.AsyncClient,
        permission: Literal["contents", "issues", "pull_requests"],
        level: Literal["read", "write"],
    ) -> str:
        key = (permission, level)
        async with self._lock:
            now = datetime.now(UTC)
            cached = self._tokens.get(key)
            if cached is not None and cached[1] > now + timedelta(minutes=1):
                return cached[0]
            response = await client.post(
                f"https://api.github.com/app/installations/{self._installation_id}/access_tokens",
                headers={**GITHUB_API_HEADERS, "Authorization": f"Bearer {self._jwt(now)}"},
                json={"repository_ids": [self.repository_id], "permissions": {permission: level}},
                follow_redirects=False,
            )
            if response.status_code != 201:
                if (
                    permission == "pull_requests"
                    and level == "read"
                    and response.status_code == 422
                ):
                    raise GitHubAppError(
                        "Approve Pull requests: Read-only on the GitHub App installation."
                    )
                raise GitHubAppError(
                    "GitHub could not authorize the app installation "
                    f"(HTTP {response.status_code})."
                )
            try:
                payload = response.json()
                token = payload["token"]
                permissions = payload["permissions"]
                expires_at = datetime.fromisoformat(payload["expires_at"])
                if (
                    not isinstance(token, str)
                    or not 1 <= len(token) <= 4096
                    or not token.isascii()
                    or any(not 33 <= ord(char) <= 126 for char in token)
                    or not isinstance(permissions, dict)
                    or permissions.get(permission) != level
                    or not permissions.keys() <= {permission, "metadata"}
                    or permissions.get("metadata", "read") != "read"
                    or expires_at.tzinfo is None
                    or not now < expires_at <= now + timedelta(minutes=65)
                ):
                    raise ValueError
            except KeyError, TypeError, ValueError:
                raise GitHubAppError(
                    "GitHub returned an invalid installation token response."
                ) from None
            self._tokens[key] = (token, expires_at)
            return token
