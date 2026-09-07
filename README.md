# repo-surgeon

## Quality checks

GitHub Actions runs the backend and frontend quality gates independently on every
push and pull request. The checks use the committed lockfiles and do not require a
model API key or external services.

Run the same checks locally from each project directory:

```sh
cd backend
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests
uv run pytest
```

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Local PostgreSQL

The development database runs in Docker Compose with a named volume and is bound to
`127.0.0.1` only. The checked-in `.env.example` contains safe local defaults; copy it
to `.env` if you want to customize them.

Start PostgreSQL and wait for its readiness healthcheck:

```sh
cp .env.example .env
docker compose up --detach --wait postgres
```

Inspect readiness and follow database logs:

```sh
docker compose ps
docker compose logs --follow postgres
```

Prove that the server accepts connections and can execute SQL:

```sh
docker compose exec postgres sh -c \
  'pg_isready --host 127.0.0.1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" && \
   psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --command "SELECT 1;"'
```

Stop the service while keeping its data:

```sh
docker compose stop postgres
```

Remove the service and its named volume when you intentionally want to delete the
local database data:

```sh
docker compose down --volumes
```

The Compose file intentionally uses the current Compose Specification without a
legacy top-level `version` field. PostgreSQL is pinned to the `18.6` image release,
and its `pg_isready` check has a 10-second startup grace period plus 12 bounded
five-second retries.
