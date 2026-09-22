"""Run Alembic migrations through the application's async database dialect."""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from repo_surgeon.infrastructure.repository_models import Base
from repo_surgeon.settings import Settings

config = context.config

# Keep the CLI migration path on the same configured database as the API.
# Tests and operators may explicitly override Alembic's URL, so only replace
# the committed local default when the application environment supplied one.
if os.environ.get("REPO_SURGEON_DATABASE_URL") is not None:
    configured_url = Settings().database_url.replace("%", "%%")
    config.set_main_option("sqlalchemy.url", configured_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Generate SQL without opening a database connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with Alembic's synchronous connection facade."""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Open an async connection and adapt it for Alembic."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations against the configured database."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
