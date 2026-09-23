"""Typed application settings loaded from the environment."""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AccessMode = Literal["local_trusted", "public_authenticated"]


class Settings(BaseSettings):
    """Typed runtime policy with a safe local default and public fail-closed mode."""

    app_name: str = "Repo Surgeon API"
    environment: Literal["development", "test", "production"] = "development"
    access_mode: AccessMode = "local_trusted"
    public_origin: str = "http://127.0.0.1:3000"
    allowed_hosts: list[str] = Field(default_factory=lambda: ["127.0.0.1", "localhost"])
    cors_allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    csrf_trusted_origins: list[str] = Field(default_factory=list)

    github_oauth_client_id: str | None = None
    github_oauth_client_secret: str | None = None
    github_oauth_callback_url: str | None = None
    auth_encryption_key: str | None = None

    session_idle_ttl_seconds: int = Field(default=43_200, ge=60, le=604_800)
    session_absolute_ttl_seconds: int = Field(default=604_800, ge=300, le=2_592_000)
    oauth_transaction_ttl_seconds: int = Field(default=600, ge=60, le=900)
    cookie_secure: bool = False
    local_repository_access: bool = True
    database_url: str = (
        "postgresql+asyncpg://repo_surgeon:repo_surgeon_local_only@127.0.0.1:5432/repo_surgeon"
    )

    model_config = SettingsConfigDict(
        env_prefix="REPO_SURGEON_",
        # README setup creates .env at the repository root before changing into
        # backend. Keep that documented workflow working for both the API and
        # Alembic, while still allowing a process-local .env when running from
        # another checkout directory.
        env_file=(Path(__file__).resolve().parents[3] / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def oauth_callback_url(self) -> str:
        """Return the only callback accepted by the authentication contract."""
        return self.github_oauth_callback_url or (
            f"{self.public_origin.rstrip('/')}/api/v1/auth/github/callback"
        )

    @model_validator(mode="after")
    def validate_security_contract(self) -> Settings:
        """Reject ambiguous origins, unsafe combinations, and incomplete public config."""
        origin = urlsplit(self.public_origin)
        if (
            origin.scheme not in {"http", "https"}
            or not origin.netloc
            or origin.username is not None
            or origin.password is not None
        ):
            raise ValueError("PUBLIC_ORIGIN must be an exact HTTP(S) origin")
        if origin.path not in {"", "/"} or origin.query or origin.fragment:
            raise ValueError("PUBLIC_ORIGIN must not contain a path, query, or fragment")

        if any(origin_value.strip() == "*" for origin_value in self.cors_allowed_origins):
            raise ValueError("CORS_ALLOWED_ORIGINS must not contain a wildcard")
        if not self.allowed_hosts or any(host.strip() in {"", "*"} for host in self.allowed_hosts):
            raise ValueError("ALLOWED_HOSTS must contain exact host names")
        if self.session_absolute_ttl_seconds < self.session_idle_ttl_seconds:
            raise ValueError("SESSION_ABSOLUTE_TTL_SECONDS must be at least the idle TTL")

        if self.access_mode == "public_authenticated":
            if self.local_repository_access:
                raise ValueError(
                    "LOCAL_REPOSITORY_ACCESS must be false in public_authenticated mode"
                )
            if not self.cookie_secure:
                raise ValueError("public_authenticated requires secure cookies")
            if not self.github_oauth_client_id:
                raise ValueError("GITHUB_OAUTH_CLIENT_ID is required in public_authenticated mode")
            if not self.github_oauth_client_secret:
                raise ValueError(
                    "GITHUB_OAUTH_CLIENT_SECRET is required in public_authenticated mode"
                )
            if not self.auth_encryption_key:
                raise ValueError("AUTH_ENCRYPTION_KEY is required in public_authenticated mode")
            callback = urlsplit(self.oauth_callback_url)
            expected_path = "/api/v1/auth/github/callback"
            if (
                (callback.scheme, callback.netloc, callback.path)
                != (
                    origin.scheme,
                    origin.netloc,
                    expected_path,
                )
                or callback.query
                or callback.fragment
            ):
                raise ValueError("GITHUB_OAUTH_CALLBACK_URL must be the fixed public callback")

        if self.environment == "production":
            if self.access_mode != "public_authenticated":
                raise ValueError("production requires public_authenticated access mode")
            if origin.scheme != "https":
                raise ValueError("production PUBLIC_ORIGIN must use HTTPS")
            if self.database_url.endswith("repo_surgeon_local_only@127.0.0.1:5432/repo_surgeon"):
                raise ValueError("production must not use the local development database")
        return self


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
