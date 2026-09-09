# Architecture overview

Milestone 0 proves a fresh clone can run a typed Python API, a strict TypeScript frontend, optional PostgreSQL through Compose, and repeatable quality gates.

```text
curl -> Uvicorn on 127.0.0.1:8000 -> FastAPI health router -> Pydantic JSON
browser -> Next.js on localhost:3000 -> static workspace preview
```

`backend/src/repo_surgeon/main.py` creates the FastAPI application and includes the health router. `backend/src/repo_surgeon/api/health.py` returns deterministic `live` and `ready` responses. `backend/src/repo_surgeon/settings.py` supplies typed settings, but no external service is consumed yet.

`frontend/src/app/page.tsx` displays example workspace data only. It does not read repositories, call an API, invoke models or MCP tools, run tests, or create patches.

`docker-compose.yml` provides PostgreSQL 18.6 on loopback with `pg_isready`. There are no database models, migrations, connections, or database-aware readiness checks in M0.

## Current contracts

| Surface | Implemented contract | Limit |
| --- | --- | --- |
| Liveness | `GET /health/live` returns `{"status":"live"}` | Proves the API serves HTTP. |
| Readiness | `GET /health/ready` returns `{"status":"ready"}` | No dependencies are checked in M0. |
| Frontend | Next.js App Router with strict TypeScript | Static preview, not product workflow. |
| PostgreSQL | Compose starts local database | Application does not connect. |
| CI | Locked installs, format, lint, types, tests, build | No integration or browser E2E jobs in M0. |

## Intended architecture, not current implementation

Later milestones target a modular monolith: `domain <- application <- infrastructure / api / agent / mcp / sandbox`.

Domain will own rules and state machines; application will own use cases and ports; infrastructure will adapt external services; API will validate HTTP; agent will orchestrate bounded work; MCP will expose narrow tools; sandbox will isolate execution. These modules are targets, not placeholders. Repository access, providers, MCP, sandboxing, proposals, approvals, persistence, and audit events do not exist yet.

GitHub Actions installs `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then runs the exact commands in the [README](../../README.md). This makes fresh-clone verification reproducible.
