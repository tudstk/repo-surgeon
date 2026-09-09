# Milestone retrospectives

## Milestone 0: executable foundation

### Outcome and boundary

M0 provides a typed FastAPI health service, strict Next.js frontend, optional Compose PostgreSQL, and locked CI quality gates. It does not implement repository registration, code reading, models, MCP, persistence, sandboxing, proposals, approvals, patch application, audits, or pull requests. The workspace-looking frontend content is static example data.

### Concepts and C# bridge

The milestone introduces `pyproject.toml`, uv and lockfiles, ASGI, FastAPI, Pydantic models and settings, strict mypy and TypeScript, Compose, and CI gates. `create_app` is analogous to composing an ASP.NET Core application, a FastAPI router resembles a small endpoint group, `HealthResponse` is a validated DTO, and Settings resembles typed options binding. Python type hints need mypy and Pydantic support rather than compiler enforcement identical to C#.

### Read these three files in order

1. [`backend/pyproject.toml`](../../backend/pyproject.toml) - supported Python, tools, and strict checks.
2. [`backend/src/repo_surgeon/main.py`](../../backend/src/repo_surgeon/main.py) - application construction and router registration.
3. [`backend/src/repo_surgeon/api/health.py`](../../backend/src/repo_surgeon/api/health.py) - response model and deterministic endpoints.

### Request flow

1. Start Uvicorn with `uv run uvicorn repo_surgeon.main:app --reload --host 127.0.0.1 --port 8000` from `backend/`.
2. `curl http://127.0.0.1:8000/health/live` reaches Uvicorn through ASGI.
3. FastAPI routes the request to `get_liveness`.
4. `HealthResponse(status="live")` is validated and serialized to JSON.

This flow has no database query, repository access, model call, tool invocation, or agent work.

### Reliability invariant

**Health endpoints have no external dependency.** Both handlers return fixed typed states and [`backend/tests/test_health.py`](../../backend/tests/test_health.py) verifies the contract. `/health/ready` must not be interpreted as database or provider readiness until those dependencies are implemented.

### Commands

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

To modify this feature, add a response field only after extending `backend/tests/test_health.py`, then update the handler and README contract.

### Interview questions

1. Why do lockfiles improve reproducibility?
2. What differs between liveness and readiness?
3. How does Pydantic differ from a plain Python class?
4. Why can a synchronous route run under ASGI?
5. What does `pnpm install --frozen-lockfile` prevent?

### Practice extension

Without agent assistance, add `GET /version` with an explicit response model and one owned version source. Test it first, document it, and run all backend checks. Do not add a database or model key.

### Retrospective

**Worked:** a dependency-free API is quick to start and test, while locked dependencies make verification repeatable.

**Surprised:** Compose can establish local infrastructure without being an application runtime dependency.

**Next:** add only safe repository registration with confinement tests. Do not make static UI content appear to be agent behavior.
