# Architecture overview

Milestone 4.5C extends the bounded read-only foundation with identity-only GitHub OAuth, opaque browser sessions, and a same-origin frontend authentication journey. The bounded bug-investigation workflow and deterministic evaluation proof remain in place.

```text
curl -> Uvicorn on 127.0.0.1:8000 -> FastAPI routers -> Pydantic JSON
browser -> Next.js on 127.0.0.1:3000 -> same-origin /api proxy -> FastAPI on 127.0.0.1:8000
agent -> ModelProvider -> bounded agent loop -> in-process MCP tools -> confined files / killable ripgrep
```

`backend/src/repo_surgeon/main.py` creates the FastAPI application and includes the health and repository routers. `backend/src/repo_surgeon/api/health.py` returns deterministic `live` and `ready` responses. `backend/src/repo_surgeon/settings.py` supplies typed settings. The agent package owns the provider protocol and bounded turn orchestration; the MCP package owns typed, read-only file and search adapters.

`frontend/src/app/auth-shell.tsx` drives the login, callback, profile, and session-checked workspace entry screens through same-origin `/api/*` requests; the Next.js rewrite proxies them to FastAPI so the HttpOnly session cookie remains usable. The workspace entry makes no repository requests and truthfully states that repository connections are unavailable until tenant authorization lands. The identity UI does not execute tests or create patches.

`docker-compose.yml` provides PostgreSQL 18.6 on loopback with `pg_isready`. Authentication persistence, repository registration, and the local read-only repository workflow use SQLAlchemy and PostgreSQL; readiness remains dependency-free and does not check the database or repositories.

## Current contracts

| Surface | Implemented contract | Limit |
| --- | --- | --- |
| Liveness | `GET /health/live` returns `{"status":"live"}` | Proves the API serves HTTP. |
| Readiness | `GET /health/ready` returns `{"status":"ready"}` | No dependencies are checked. |
| Frontend | Next.js App Router with strict TypeScript | Login, callback, safe profile, and session-checked workspace entry screens; the workspace exposes no repository data until repository authorization is available. |
| Identity | FastAPI-owned GitHub OAuth and opaque browser session | Same-origin `/api/*` proxy, PKCE/state validation, HttpOnly `SameSite=Lax` cookie, and safe profile projection; repository authorization is not yet available. |
| PostgreSQL | Compose starts local database | Stores registered repository identities used by the local backend workflow. |
| Safe file tools | In-process `list_files` and `read_file` adapters | Read-only, confined, bounded results; no external MCP transport. |
| Agent loop | `run_turn` with `ModelProvider` and `FakeModelProvider` | Bounded model/tool calls, wall-clock time, repeats, and returned bytes. |
| Exact search | Typed `search_code` with a fixed ripgrep argv | Literal or regex mode, safe ignored files, exact citations, independent bounds. |
| Repository intelligence | Versioned language and test-command heuristics | Bounded reads only; reports ambiguity and partial scans; never executes commands. |
| Bug investigation | Fixed bounded search plan and seeded behavioral proof | Ranks only retrieved evidence; canonical seeded proof is identity- and question-bound; unsupported questions return insufficient evidence. |
| CI | Locked installs, format, lint, types, tests, browser E2E, and build | Browser E2E uses the frontend's configured web server and deterministic route stubs. |

## Intended architecture, not current implementation

The modular monolith follows `domain <- application <- infrastructure / api / agent / mcp / sandbox`.

Domain owns rules and state machines; application owns use cases and ports; infrastructure adapts external services; API validates HTTP; agent orchestrates bounded work; MCP exposes narrow tools; sandbox will isolate execution. Repository access, providers, and safe MCP file tools now exist in bounded slices. Sandbox execution, proposals, approvals, persistence of agent traces, and audit events remain future work.

GitHub Actions installs `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then runs the exact commands in the [README](../../README.md). This makes fresh-clone verification reproducible.
