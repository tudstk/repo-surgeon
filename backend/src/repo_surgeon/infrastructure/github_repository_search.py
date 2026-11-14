"""Public GitHub discovery through a fixed, credential-free upstream endpoint."""

from dataclasses import dataclass
from re import fullmatch

import httpx

# Search text is data. Only the application can supply GitHub search qualifiers.
SEARCH_PATTERN = r"^(?:[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*|[A-Za-z0-9-]+/[A-Za-z0-9._-]+)$"
_NAME_PATTERN = r"[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}"
_LIMIT = 12


@dataclass(frozen=True, slots=True)
class PublicGitHubRepository:
    """Public metadata needed by the workspace picker."""

    full_name: str
    owner_avatar_url: str | None


@dataclass(frozen=True, slots=True)
class GitHubRepositorySearchError(Exception):
    """A failed upstream search without provider response details."""

    rate_limited: bool = False


def _public_result(item: object) -> PublicGitHubRepository | None:
    if not isinstance(item, dict) or item.get("private") is not False:
        return None
    if item.get("visibility", "public") != "public":
        return None
    name = item.get("full_name")
    if not isinstance(name, str) or not fullmatch(_NAME_PATTERN, name):
        return None
    if name.split("/", 1)[1] in {".", ".."}:
        return None
    owner = item.get("owner")
    owner_id = owner.get("id") if isinstance(owner, dict) else None
    avatar = None
    if type(owner_id) is int and 0 < owner_id < 2**63:
        avatar = f"https://avatars.githubusercontent.com/u/{owner_id}?s=64"
    return PublicGitHubRepository(full_name=name, owner_avatar_url=avatar)


class GitHubRepositorySearch:
    """Fetch and project one small page of public repository suggestions."""

    def __init__(self, *, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(timeout=5.0, follow_redirects=False)
        self._owns_client = client is None

    async def aclose(self) -> None:
        """Release the application HTTP client at shutdown."""
        if self._owns_client:
            await self._client.aclose()

    async def search(self, query: str) -> list[PublicGitHubRepository]:
        """Search by name or resolve an exact owner/repository match."""
        match = f"repo:{query}" if "/" in query else f'"{query}" in:name'
        try:
            response = await self._client.get(
                "https://api.github.com/search/repositories",
                params={"q": f"{match} is:public fork:true", "per_page": _LIMIT},
                headers={
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            if response.status_code == 429 or (
                response.status_code == 403
                and (
                    response.headers.get("X-RateLimit-Remaining") == "0"
                    or "Retry-After" in response.headers
                )
            ):
                raise GitHubRepositorySearchError(rate_limited=True)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise GitHubRepositorySearchError from error
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise GitHubRepositorySearchError
        return [
            result
            for item in payload["items"][:_LIMIT]
            if (result := _public_result(item)) is not None
        ]
