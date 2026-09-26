"""Narrow outbound port for identity-only GitHub OAuth."""

from __future__ import annotations

from typing import Protocol

from repo_surgeon.application.authentication import GitHubProfile
from repo_surgeon.domain.authentication import PkceVerifier


class GitHubOAuthError(Exception):
    """A provider failure safe to map to a generic browser-facing result."""


class GitHubOAuthClient(Protocol):
    """Exchange one code and return only a validated safe profile snapshot."""

    async def authenticate(self, code: str, verifier: PkceVerifier) -> GitHubProfile:
        """Perform the code exchange and one authenticated `/user` request."""
