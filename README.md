# repo-surgeon

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
