# Architecture overview

Milestone 2 extends the Milestone 0 foundation with bounded read-only repository tools and a deterministic provider-facing agent loop.

```text
curl -> Uvicorn on 127.0.0.1:8000 -> FastAPI routers -> Pydantic JSON
browser -> Next.js on localhost:3000 -> static workspace preview
agent -> ModelProvider -> bounded agent loop -> in-process MCP file tools -> confined repository files
```

`backend/src/repo_surgeon/main.py` creates the FastAPI application and includes the health and repository routers. `backend/src/repo_surgeon/api/health.py` returns deterministic `live` and `ready` responses. `backend/src/repo_surgeon/settings.py` supplies typed settings. The agent package owns the provider protocol and bounded turn orchestration; the MCP package owns typed, read-only file adapters.

`frontend/src/app/page.tsx` displays example workspace data only. It does not call the agent loop, run tests, or create patches.

`docker-compose.yml` provides PostgreSQL 18.6 on loopback with `pg_isready`. There are no database models, migrations, connections, or database-aware readiness checks in M0.

## Current contracts

| Surface | Implemented contract | Limit |
| --- | --- | --- |
| Liveness | `GET /health/live` returns `{"status":"live"}` | Proves the API serves HTTP. |
| Readiness | `GET /health/ready` returns `{"status":"ready"}` | No dependencies are checked in M0. |
| Frontend | Next.js App Router with strict TypeScript | Static preview, not product workflow. |
| PostgreSQL | Compose starts local database | Application does not connect. |
| Safe file tools | In-process `list_files` and `read_file` adapters | Read-only, confined, bounded results; no external MCP transport. |
| Agent loop | `run_turn` with `ModelProvider` and `FakeModelProvider` | Bounded model/tool calls, wall-clock time, repeats, and returned bytes. |
| CI | Locked installs, format, lint, types, tests, build | No integration or browser E2E jobs in M0. |

## Intended architecture, not current implementation

The modular monolith follows `domain <- application <- infrastructure / api / agent / mcp / sandbox`.

Domain owns rules and state machines; application owns use cases and ports; infrastructure adapts external services; API validates HTTP; agent orchestrates bounded work; MCP exposes narrow tools; sandbox will isolate execution. Repository access, providers, and safe MCP file tools now exist in bounded slices. Sandbox execution, proposals, approvals, persistence of agent traces, and audit events remain future work.

GitHub Actions installs `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then runs the exact commands in the [README](../../README.md). This makes fresh-clone verification reproducible.
