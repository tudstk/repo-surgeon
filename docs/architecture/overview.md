# Architecture overview

Milestone 4 extends the Milestone 3 foundation with a bounded read-only bug-investigation workflow and deterministic evaluation proof for the canonical seeded fixture.

```text
curl -> Uvicorn on 127.0.0.1:8000 -> FastAPI routers -> Pydantic JSON
browser -> Next.js on localhost:3000 -> typed summary, search activity, and investigation display
agent -> ModelProvider -> bounded agent loop -> in-process MCP tools -> confined files / killable ripgrep
```

`backend/src/repo_surgeon/main.py` creates the FastAPI application and includes the health and repository routers. `backend/src/repo_surgeon/api/health.py` returns deterministic `live` and `ready` responses. `backend/src/repo_surgeon/settings.py` supplies typed settings. The agent package owns the provider protocol and bounded turn orchestration; the MCP package owns typed, read-only file and search adapters.

`frontend/src/app/page.tsx` loads the registered repository list, fetches bounded summary metadata for the selected repository, submits the fixed `SessionManager` search projection, and posts bounded investigation questions. Search citations and ranked investigation evidence render the returned match and context lines in the read-only work panel. It does not execute tests or create patches.

`docker-compose.yml` provides PostgreSQL 18.6 on loopback with `pg_isready`. Repository registration and the read-only repository list use SQLAlchemy and PostgreSQL; readiness remains dependency-free and does not check the database or repositories.

## Current contracts

| Surface | Implemented contract | Limit |
| --- | --- | --- |
| Liveness | `GET /health/live` returns `{"status":"live"}` | Proves the API serves HTTP. |
| Readiness | `GET /health/ready` returns `{"status":"ready"}` | No dependencies are checked. |
| Frontend | Next.js App Router with strict TypeScript | Read-only repository selector, summary, bounded search projection, and bug-investigation results. |
| PostgreSQL | Compose starts local database | Stores registered repository identities used by frontend requests. |
| Safe file tools | In-process `list_files` and `read_file` adapters | Read-only, confined, bounded results; no external MCP transport. |
| Agent loop | `run_turn` with `ModelProvider` and `FakeModelProvider` | Bounded model/tool calls, wall-clock time, repeats, and returned bytes. |
| Exact search | Typed `search_code` with a fixed ripgrep argv | Literal or regex mode, safe ignored files, exact citations, independent bounds. |
| Repository intelligence | Versioned language and test-command heuristics | Bounded reads only; reports ambiguity and partial scans; never executes commands. |
| Bug investigation | Fixed bounded search plan and seeded behavioral proof | Ranks only retrieved evidence; canonical seeded proof is identity- and question-bound; unsupported questions return insufficient evidence. |
| CI | Locked installs, format, lint, types, tests, build | No integration or browser E2E jobs yet. |

## Intended architecture, not current implementation

The modular monolith follows `domain <- application <- infrastructure / api / agent / mcp / sandbox`.

Domain owns rules and state machines; application owns use cases and ports; infrastructure adapts external services; API validates HTTP; agent orchestrates bounded work; MCP exposes narrow tools; sandbox will isolate execution. Repository access, providers, and safe MCP file tools now exist in bounded slices. Sandbox execution, proposals, approvals, persistence of agent traces, and audit events remain future work.

GitHub Actions installs `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then runs the exact commands in the [README](../../README.md). This makes fresh-clone verification reproducible.
