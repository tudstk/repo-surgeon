"""Typed application settings loaded from the environment."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration with safe local defaults for Milestone 0."""

    app_name: str = "Repo Surgeon API"
    environment: Literal["development", "test", "production"] = "development"

    model_config = SettingsConfigDict(
        env_prefix="REPO_SURGEON_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
