# Repo Surgeon

Repo Surgeon is a local-first, human-controlled coding assistant for understanding and safely changing Git repositories.

## Milestone 0 status

This checkout provides an executable foundation: a typed FastAPI process, a strict TypeScript and Next.js frontend, optional local PostgreSQL through Docker Compose, and CI quality gates. The implemented API only reports process health.

The frontend is a visual shell with static example repositories, activity, tests, and diff content. It is not a connected repository browser, agent, model integration, MCP tool surface, sandbox, patch workflow, or approval system. See [product scope](docs/product/scope.md) for the implemented boundary and roadmap.

No model API key is required.

## Prerequisites

- Python 3.14.x and [uv](https://docs.astral.sh/uv/) 0.12.9.
- Node.js 22.22.2 or newer in the 22.x line and pnpm 10.8.x. The supported ranges are in [frontend/package.json](frontend/package.json).
- curl for health checks.
- Docker Engine and Docker Compose only when starting local PostgreSQL.

Use the committed lockfiles. Do not update dependencies during setup.

## Start the backend

From the repository root:

```sh
cd backend
uv sync --locked
uv run uvicorn repo_surgeon.main:app --reload --host 127.0.0.1 --port 8000
```

The API listens on `127.0.0.1:8000`. In another terminal, run the two implemented health checks:

```sh
curl --fail --silent --show-error http://127.0.0.1:8000/health/live
curl --fail --silent --show-error http://127.0.0.1:8000/health/ready
```

They return `{"status":"live"}` and `{"status":"ready"}`. At M0, readiness is dependency-free: it does not check PostgreSQL, repositories, a sandbox, or a provider. FastAPI documentation is available at <http://127.0.0.1:8000/docs>.

## Start the frontend

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. The rendered workspace data is static preview content and does not invoke the backend or perform agent actions.

## Optional local PostgreSQL

Compose defines PostgreSQL 18.6 on `127.0.0.1:5432` with a named volume and health check. The backend does not yet connect to it, so this is optional for M0.

```sh
cp .env.example .env
docker compose up -d postgres
docker compose ps
docker compose exec postgres pg_isready -U repo_surgeon -d repo_surgeon
docker compose down
```

The checked-in credentials are local-development defaults only. `docker compose down` preserves data. `docker compose down -v` removes the local database volume and should only be used for an intentional reset. If Docker is unavailable, skip this optional section; the health checks and quality gates do not require it.

## Verify quality gates

These are the commands enforced by [GitHub Actions](.github/workflows/quality-gates.yml):

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

The workflow runs on pushes and pull requests. It uses `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then checks backend formatting, linting, strict typing, and tests plus frontend formatting, linting, type checking, tests, and production build.

## Learn the foundation

The implemented request path is `curl -> Uvicorn ASGI server -> FastAPI health router -> Pydantic response -> JSON`. The frontend is independent at M0. Read the [architecture baseline](docs/architecture/overview.md), [C# and Python concept map](docs/learning/glossary.md), and [Milestone 0 learning checkpoint](docs/learning/milestone-retrospectives.md).

Future work begins with safe repository registration and bounded file reading. Model providers, MCP, persistence, test sandboxing, proposals, approvals, patch application, audits, and pull requests are roadmap only.
