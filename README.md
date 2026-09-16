# Repo Surgeon

Repo Surgeon is a local-first, human-controlled coding assistant for understanding and safely changing Git repositories.

## Implemented status

This checkout provides an executable foundation: a typed FastAPI process, a strict TypeScript and Next.js frontend, local PostgreSQL through Docker Compose, and CI quality gates. It also registers an existing local Git working tree and persists its resolved canonical root. The backend includes bounded read-only file and exact-search tools, deterministic repository intelligence, and a deterministic model-provider agent loop.

Registration validates only the selected path and Git worktree boundary. The MCP tools read and search bounded safe content, and the agent loop can use only those read-only capabilities through a provider boundary. Repository intelligence maps bounded manifest evidence to versioned language and test-command catalogs without executing repository code. There is still no HTTP MCP transport, repository indexing, URL cloning, repository mutation, sandbox, patch workflow, or approval system. The frontend now loads registered repository names and bounded summary metadata from the backend, alongside typed search activity and exact citation states. See [safe search](docs/mcp/safe-search-tools.md) and [product scope](docs/product/scope.md).

No model API key is required.

## Prerequisites

- Python 3.14.x and [uv](https://docs.astral.sh/uv/) 0.12.9.
- Node.js 22.22.2 or newer in the 22.x line and pnpm 10.8.x. The supported ranges are in [frontend/package.json](frontend/package.json).
- curl for health checks.
- Docker Engine and Docker Compose only when starting local PostgreSQL.

Use the committed lockfiles. Do not update dependencies during setup.

## Start PostgreSQL and apply migrations

Repository registration persists records in PostgreSQL. Start the local database before starting the backend:

```sh
cp .env.example .env
docker compose up -d postgres
docker compose exec postgres pg_isready -U repo_surgeon -d repo_surgeon
cd backend
uv sync --locked
uv run alembic upgrade head
```

The default `REPO_SURGEON_DATABASE_URL` matches Compose. Set it only when connecting to a different local PostgreSQL database. `docker compose down` preserves data; `docker compose down -v` intentionally removes the local database volume.

## Start the backend

From the repository root:

```sh
cd backend
uv sync --locked
uv run uvicorn repo_surgeon.main:app --reload --host 127.0.0.1 --port 8000
```

The API listens on `127.0.0.1:8000` and rejects non-loopback clients. Repository metadata and source search are unauthenticated within this local development trust boundary, so do not expose the process through a proxy, container port, or non-loopback bind. In another terminal, run the health checks:

```sh
curl --fail --silent --show-error http://127.0.0.1:8000/health/live
curl --fail --silent --show-error http://127.0.0.1:8000/health/ready
```

They return `{"status":"live"}` and `{"status":"ready"}`. Readiness remains dependency-free: it does not check PostgreSQL, repositories, a sandbox, or a provider. FastAPI documentation is available at <http://127.0.0.1:8000/docs>.

## Register a local repository

After migrations are applied, send an absolute path to an existing Git working tree. The API resolves symlinks and persists Git's canonical top-level root; repeated requests for the same worktree return the same record.

```sh
curl --fail --show-error \
  --request POST http://127.0.0.1:8000/repositories \
  --header 'content-type: application/json' \
  --data '{"path":"/absolute/path/to/a/git-working-tree"}'
```

Use the returned `id` to retrieve the record:

```sh
curl --fail --show-error http://127.0.0.1:8000/repositories/<id>
```

Invalid roots and malformed repository requests return `application/problem+json` with a stable `code`. Registration never reads source files or modifies the selected worktree.

## Start the frontend

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. The workspace selector requests `GET /repositories`, and the selected summary card requests `GET /repositories/<id>/summary`. The backend and PostgreSQL must be running for live repository data. Development CORS permits only `http://localhost:3000` and `http://127.0.0.1:3000`; the frontend uses `NEXT_PUBLIC_API_BASE_URL` when the API is not at `http://127.0.0.1:8000`. The frontend remains read-only and does not perform agent actions.

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

The registration, summary, and search request paths are `curl or frontend -> Uvicorn ASGI server -> FastAPI router -> application use case -> confined repository inspection`, with registration and repository identity persistence continuing through the SQLAlchemy adapter to PostgreSQL. Read the [architecture baseline](docs/architecture/overview.md), [C# and Python concept map](docs/learning/glossary.md), and [Milestone retrospectives](docs/learning/milestone-retrospectives.md).

Future work continues with persisted API events, Git context, test sandboxing, proposals, approvals, patch application, audits, and pull requests. The provider boundary, bounded agent loop, and in-process MCP tools are not yet connected to the frontend workflow.
