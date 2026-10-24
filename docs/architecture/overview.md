# Architecture overview

Stage 0 of Milestone 5 extends the bounded read-only foundation with identity-only GitHub OAuth, opaque browser sessions, and a same-origin frontend authentication journey. Authenticated users can now select an owned repository, create a tenant-scoped product session, submit one deterministic read-only turn, and reconnect to persisted normalized events. The bounded bug-investigation workflow and deterministic evaluation proof remain in place.

```text
curl -> Uvicorn on 127.0.0.1:8000 -> FastAPI routers -> Pydantic JSON
browser -> Next.js on 127.0.0.1:3000 -> same-origin /api proxy -> FastAPI on 127.0.0.1:8000
agent -> ModelProvider -> bounded agent loop -> in-process MCP tools -> confined files / killable ripgrep
browser -> owner-scoped workspace API -> persisted session/run/event records -> resumable SSE
```

`backend/src/repo_surgeon/main.py` creates the FastAPI application and includes the health and repository routers. `backend/src/repo_surgeon/api/health.py` returns deterministic `live` and `ready` responses. `backend/src/repo_surgeon/settings.py` supplies typed settings. The agent package owns the provider protocol and bounded turn orchestration; the MCP package owns typed, read-only file and search adapters.

`frontend/src/app/auth-shell.tsx` drives the login, callback, profile, and session-checked workspace entry screens through same-origin `/api/*` requests; the Next.js rewrite proxies them to FastAPI so the HttpOnly session cookie remains usable. `frontend/src/app/workspace.tsx` uses the versioned owner-scoped repository and session APIs, submits one CSRF-protected turn, and reconnects to persisted normalized SSE events. The workspace does not execute tests, create patches, or expose write controls.

`docker-compose.yml` provides PostgreSQL 18.6 on loopback with `pg_isready`. Authentication persistence, repository registration, and the local read-only repository workflow use SQLAlchemy and PostgreSQL; readiness remains dependency-free and does not check the database or repositories.

## Current contracts

| Surface | Implemented contract | Limit |
| --- | --- | --- |
| Liveness | `GET /health/live` returns `{"status":"live"}` | Proves the API serves HTTP. |
| Readiness | `GET /health/ready` returns `{"status":"ready"}` | No dependencies are checked. |
| Frontend | Next.js App Router with strict TypeScript | Login, callback, safe profile, and authenticated three-pane workspace; one bounded read-only turn and persisted event resume. |
| Identity | FastAPI-owned GitHub OAuth and opaque browser session | Same-origin `/api/*` proxy, PKCE/state validation, HttpOnly `SameSite=Lax` cookie, safe profile projection, and current-principal tenant boundary. |
| PostgreSQL | Compose starts local database | Stores registered repository identities used by the local backend workflow. |
| Safe file tools | In-process `list_files` and `read_file` adapters | Read-only, confined, bounded results; no external MCP transport. |
| Agent loop | `run_turn` with `ModelProvider` and `FakeModelProvider` | Bounded model/tool calls, wall-clock time, repeats, and returned bytes. |
| Product sessions | `/api/v1/sessions` and `/api/v1/sessions/{id}/turns` | Owner-scoped conversation sessions and one deterministic fake-provider read-only turn; POST requires exact Origin and session CSRF. |
| Run events | `/api/v1/agent-runs/{id}/events` | Persisted normalized events with `Last-Event-ID` resume; foreign and unknown IDs are indistinguishable 404s. |
| Exact search | Typed `search_code` with a fixed ripgrep argv | Literal or regex mode, safe ignored files, exact citations, independent bounds. |
| Repository intelligence | Versioned language and test-command heuristics | Bounded reads only; reports ambiguity and partial scans; never executes commands. |
| Bug investigation | Fixed bounded search plan and seeded behavioral proof | Ranks only retrieved evidence; canonical seeded proof is identity- and question-bound; unsupported questions return insufficient evidence. |
| CI | Locked installs, format, lint, types, tests, browser E2E, and build | Browser E2E uses the frontend's configured web server and deterministic route stubs. |

## Intended architecture, not current implementation

The modular monolith follows `domain <- application <- infrastructure / api / agent / mcp / sandbox`.

Domain owns rules and state machines; application owns use cases and ports; infrastructure adapts external services; API validates HTTP; agent orchestrates bounded work; MCP exposes narrow tools; sandbox will isolate execution. Repository access, providers, safe MCP file tools, product sessions, persisted agent traces, and resumable events now exist in bounded slices. Sandbox execution, proposals, approvals, and audit events remain future work.

GitHub Actions installs `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then runs the exact commands in the [README](../../README.md). This makes fresh-clone verification reproducible.
