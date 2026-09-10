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

## Milestone 1: local repository registration

### Outcome and boundary

M1 adds a narrow durable capability: register an existing local Git working tree, persist its canonical root, and retrieve the resulting record. A registration validates the selected directory with Git and resolves symlinks before persistence. It does not read source files, index a repository, clone a URL, expose file tools, or mutate the connected working tree.

### Concepts and C# bridge

The implementation separates a domain `Repository` value from its SQLAlchemy `RepositoryRecord` and FastAPI request/response models. This is analogous to keeping an EF Core entity separate from a domain object and an ASP.NET Core DTO. `RegisterLocalRepository` is an application use case; its resolver and store are ports, while the Git subprocess and SQLAlchemy session are infrastructure adapters. Alembic migrations play the role of EF Core migrations, but are explicit Python modules applied with `alembic upgrade head`.

### Request flow

1. `POST /repositories` accepts an absolute candidate path.
2. The Git resolver resolves symlinks, verifies the directory is inside a Git worktree, and returns Git's top-level root.
3. The application use case returns an existing record for the same canonical root or asks the SQLAlchemy adapter to persist one.
4. The API returns the typed record, or a stable `application/problem+json` error without exposing internal filesystem or database details.

### Reliability and security invariants

- Canonical roots, not client-provided spellings, determine identity and duplicate behavior.
- Registration runs only Git's minimal worktree query. It does not enumerate or read repository files.
- Repository registration is read-only with respect to the selected worktree.
- Database schema is created only through the Alembic migration chain, including test setup.
- Malformed registration requests and invalid repository IDs use the same stable problem-details shape as invalid roots.

### Commands

```sh
docker compose up -d postgres
cd backend
uv sync --locked
uv run alembic upgrade head
uv run pytest
```

For the optional migration-backed PostgreSQL integration check, create a disposable database and point the test at it:

```sh
REPO_SURGEON_TEST_DATABASE_URL=postgresql+asyncpg://user:password@127.0.0.1:5432/repo_surgeon_test \
  uv run pytest -m postgres
```

Never point that variable at the normal development database. The test intentionally rejects the default URL.

### Read these files in order

1. [`backend/src/repo_surgeon/domain/repositories.py`](../../backend/src/repo_surgeon/domain/repositories.py) - framework-free repository identity.
2. [`backend/src/repo_surgeon/application/repositories.py`](../../backend/src/repo_surgeon/application/repositories.py) - use cases and persistence/resolver ports.
3. [`backend/src/repo_surgeon/infrastructure/local_repository_root.py`](../../backend/src/repo_surgeon/infrastructure/local_repository_root.py) - minimal Git validation and canonicalization.
4. [`backend/migrations/versions/20260909_0001_create_repositories.py`](../../backend/migrations/versions/20260909_0001_create_repositories.py) - durable schema evolution.
5. [`backend/src/repo_surgeon/api/repositories.py`](../../backend/src/repo_surgeon/api/repositories.py) - typed HTTP boundary and stable errors.

### Interview questions

1. Why should the database constrain `canonical_root` even when the application checks for duplicates first?
2. Why is resolving a path before storing it safer than preserving the original string?
3. What boundary does Alembic preserve that `Base.metadata.create_all()` does not?
4. Why is Git validation allowed here while arbitrary repository source reads are not?
5. Why should API validation errors have a stable shape rather than exposing framework defaults?
