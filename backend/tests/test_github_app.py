"""Exercise repository-scoped installation authorization without live credentials."""

import asyncio
import base64
import json
import logging
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from pydantic import ValidationError
from test_github_import import archive

from repo_surgeon.domain.repositories import Repository, RepositorySource
from repo_surgeon.infrastructure.github_app import GitHubAppError, GitHubAppInstallation
from repo_surgeon.infrastructure.github_import import GitHubImporter, GitHubImportError
from repo_surgeon.settings import GitHubAppSettings, Settings


@pytest.fixture
def app_setup(tmp_path: Path) -> tuple[GitHubAppSettings, rsa.RSAPublicKey]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    path = tmp_path / "test-private-key.pem"
    path.touch(mode=0o600)
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return (
        GitHubAppSettings(app_id=123, installation_id=456, repository_id=42, private_key_path=path),
        key.public_key(),
    )


def _decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def test_app_configuration_is_local_and_private_key_is_owner_only(
    app_setup: tuple[GitHubAppSettings, rsa.RSAPublicKey],
) -> None:
    settings, _ = app_setup
    with pytest.raises(ValidationError, match="requires local_trusted"):
        Settings(github_app=settings, access_mode="public_authenticated")
    settings.private_key_path.chmod(0o644)
    with pytest.raises(GitHubAppError, match="owner-only RSA"):
        GitHubAppInstallation(settings)


@pytest.mark.anyio
async def test_installation_scopes_verifies_and_reuses_token(
    app_setup: tuple[GitHubAppSettings, rsa.RSAPublicKey],
) -> None:
    settings, public_key = app_setup
    installation = GitHubAppInstallation(settings)
    mint_count = 0

    def upstream(request: httpx.Request) -> httpx.Response:
        nonlocal mint_count
        mint_count += 1
        assert request.url == "https://api.github.com/app/installations/456/access_tokens"
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "repository_ids": [42],
            "permissions": {"contents": "read"},
        }
        scheme, jwt = request.headers["authorization"].split()
        assert scheme == "Bearer"
        header, claims, signature = jwt.split(".")
        assert json.loads(_decode(header))["alg"] == "RS256"
        payload = json.loads(_decode(claims))
        assert payload["iss"] == "123"
        assert payload["exp"] - payload["iat"] == 540
        public_key.verify(
            _decode(signature),
            f"{header}.{claims}".encode("ascii"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return httpx.Response(
            201,
            json={
                "token": "installation-fixture",
                "permissions": {"contents": "read", "metadata": "read"},
                "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        tokens = await asyncio.gather(*(installation.access_token(client) for _ in range(3)))
        assert tokens == ["installation-fixture"] * 3
        assert mint_count == 1


@pytest.mark.anyio
async def test_private_history_uses_only_matching_installation_and_validated_zip_redirect(
    app_setup: tuple[GitHubAppSettings, rsa.RSAPublicKey],
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings, _ = app_setup
    installation = GitHubAppInstallation(settings)
    saved = "a" * 40
    previous = "b" * 40
    storage = tmp_path / "storage"
    repository = Repository(
        id=uuid4(),
        source=RepositorySource.GITHUB,
        canonical_root="",
        created_at=datetime.now(UTC),
        github_full_name="owner/project",
        github_commit=saved,
    )
    repository = replace(
        repository,
        canonical_root=str(storage / str(repository.owner_user_id) / "42" / saved),
    )
    jwt_requests = []
    authenticated_requests = []
    archive_requests = []
    redirect = f"https://codeload.github.com/owner/project/legacy.zip/{previous}?token=fixture"
    upstream_id = 42

    def upstream(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/app/installations/456/access_tokens":
            jwt_requests.append(request.method)
            return httpx.Response(
                201,
                json={
                    "token": "installation-fixture",
                    "permissions": {"contents": "read"},
                    "expires_at": (datetime.now(UTC) + timedelta(minutes=20)).isoformat(),
                },
            )
        if request.url.host == "codeload.github.com":
            assert not request.headers.get("authorization")
            archive_requests.append(request.url.path)
            return httpx.Response(200, content=archive(content="historical code"))
        assert request.url.host == "api.github.com"
        if request.headers.get("authorization") != "Bearer installation-fixture":
            assert "authorization" not in request.headers
            return httpx.Response(404)
        authenticated_requests.append(request.url.path)
        if request.url.path == "/repos/owner/project":
            return httpx.Response(
                200,
                json={
                    "id": upstream_id,
                    "full_name": "owner/project",
                    "private": True,
                    "visibility": "private",
                    "default_branch": "main",
                },
            )
        if request.url.path.endswith("/branches"):
            return httpx.Response(200, json=[{"name": "main"}])
        if request.url.path.endswith("/branches/main"):
            return httpx.Response(200, json={"name": "main", "commit": {"sha": saved}})
        if request.url.path.endswith("/commits"):
            return httpx.Response(
                200,
                json=[{"sha": previous, "commit": {"message": "Earlier commit"}}],
            )
        assert request.url.path == f"/repos/owner/project/zipball/{previous}"
        return httpx.Response(302, headers={"Location": redirect})

    caplog.set_level(logging.INFO, logger="httpx")
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        importer = GitHubImporter(storage, client=client, installation=installation)
        with pytest.raises(GitHubImportError, match="HTTP 404"):
            await importer.import_public("owner/project", repository.owner_user_id)
        foreign = replace(repository, owner_user_id=uuid4())
        foreign = replace(
            foreign, canonical_root=str(storage / str(foreign.owner_user_id) / "42" / saved)
        )
        with pytest.raises(GitHubImportError, match="HTTP 404"):
            await importer.list_branches(foreign, 1)
        other_repo = replace(
            repository, canonical_root=str(storage / str(repository.owner_user_id) / "43" / saved)
        )
        with pytest.raises(GitHubImportError, match="HTTP 404"):
            await importer.list_branches(other_repo, 1)
        assert not jwt_requests
        assert not authenticated_requests

        assert (await importer.list_branches(repository, 1)).branches == ["main"]
        assert (await importer.list_branch_commits(repository, "main", 1)).commits[
            0
        ].sha == previous
        assert await importer.latest_commit(repository) == previous
        upstream_id = 43
        with pytest.raises(GitHubImportError, match="saved repository registration"):
            await importer.list_branches(repository, 1)
        upstream_id = 42
        allowed_redirect = redirect
        redirect = f"https://example.invalid/owner/project/legacy.zip/{previous}?token=fixture"
        with pytest.raises(GitHubImportError, match="unexpected archive download link"):
            await importer.prepare_history_preview(repository, "main", 1, previous)
        assert not archive_requests
        redirect = allowed_redirect
        await importer.prepare_history_preview(repository, "main", 1, previous)
        assert archive_requests == [f"/owner/project/legacy.zip/{previous}"]
        assert jwt_requests == ["POST"]
        preview = importer.history_preview_root(repository, previous)
        assert preview is not None
        assert (Path(preview.canonical_root) / "src/main.py").read_text() == "historical code"
        unconfigured = GitHubImporter(storage, client=client)
        assert unconfigured.history_preview_root(repository, previous) is None
        assert "token=fixture" not in caplog.text
