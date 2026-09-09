# Milestone 0 acceptance verification

## Target and scope

This is the reproducible acceptance record for Repo Surgeon's implemented Milestone 0 foundation.

The target is `2f769da70881a78a5a253aad1bf1d568635ea9e6` on `origin/ci/quality-gates`, the remote default branch that contains the foundation commits.

At the time of this record, `origin/main` is `4b6a7378e4210bc961d6cd1aea50caeb3280e935` and contains only the initial `README.md`.

`origin/main` cannot satisfy this matrix until the foundation is integrated there.

Milestone 0 provides a pinned FastAPI service with deterministic health routes, a strict TypeScript Next.js workspace shell, a local PostgreSQL Compose definition, and independent backend and frontend CI quality gates.

It does not provide repository registration, model calls, MCP tools, persistence, agent workflows, proposals, sandbox execution, approval, or patch application.

The frontend is a static workspace representation with inert controls, not a functional coding-agent workflow.

## Prerequisites

Start with a clean checkout of the target commit, and confirm `git status --short` produces no output.

Install Python `>=3.14,<3.15`, uv, Node `>=22.22.2 <27`, pnpm `>=10.8.0 <11`, and Docker Compose.

No model API key or external service credential is required for the quality gates.

## Acceptance matrix

| Capability | Commands | Expected observable result | Pass or fail evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short` | No output. | Commit SHA, status output, result. |
| Backend dependencies and quality | In `backend`: `uv sync --locked`; `uv run ruff format --check .`; `uv run ruff check .`; `uv run mypy src tests`; `uv run pytest`. | Locked dependencies install without changing `uv.lock`; formatting, lint, strict typing, and tests exit 0. | uv and Python versions, command output, exit code, test count, result. |
| Backend health | Start `uv run uvicorn repo_surgeon.main:app --host 127.0.0.1 --port 8000` in `backend`; then request `/health/live` and `/health/ready` with curl. | The response bodies are `{"status":"live"}` and `{"status":"ready"}`. | Command output, HTTP status, commit SHA, result. |
| Frontend dependencies and quality | In `frontend`: `pnpm install --frozen-lockfile`; `pnpm format:check`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`. | Frozen dependencies install without lockfile changes; every quality command and production build exit 0. | Node and pnpm versions, command output, exit code, test count, build output, result. |
| Static workspace boundary | In `frontend`: `pnpm test`. | Tests show workspace landmarks and that the composer, repository switcher, and Send instruction control are disabled or read-only. | Test output, commit SHA, result. |
| Local PostgreSQL definition | `cp .env.example .env`; `docker compose config --quiet`; `docker compose up --detach --wait postgres`; `docker compose ps`; then run the `pg_isready` and `SELECT 1` command in [README.md](../../README.md). | Compose validation exits 0, `postgres` is healthy, and SQL returns one row containing `1`. | Docker and Compose versions, image digest, `docker compose ps`, SQL output, result. |
| CI wiring | Inspect [quality-gates.yml](../../.github/workflows/quality-gates.yml). | Push and pull-request workflows run the command groups above with pinned setup actions. | Workflow revision, CI run URL, both job conclusions, result. |

## Negative and boundary checks

| Case | Command or observation | Expected result |
| --- | --- | --- |
| No model credential | Run both quality command groups with no model API key in the environment. | The checks do not request a model API key. |
| Unimplemented product workflow | Inspect backend routes and frontend controls during the health and frontend checks. | Only `/health/live` and `/health/ready` are implemented, and visible workspace controls do not submit instructions or alter a repository. |
| Locked dependency drift | Run `git diff -- backend/uv.lock frontend/pnpm-lock.yaml` after dependency installation. | No output. |
| Unsupported runtime | Run the prerequisite version checks before dependency installation. | An out-of-range Python, Node, or pnpm version is an environment failure, not a passing result. |
| Missing Docker access | Run `docker compose config --quiet` before `docker compose up`. | The configuration can be checked without a running daemon; inability to access the Docker socket blocks only the local PostgreSQL runtime check. |

Do not interpret the static `READ-ONLY` and `WRITE PENDING` labels as enforcement of the product's future authorization model.

Authorization, repository confinement, sandbox, proposal, approval, and apply boundaries belong to later milestones and need their own negative tests before they can be claimed.

## CI mapping

[quality-gates.yml](../../.github/workflows/quality-gates.yml) runs on every push and pull request.

The `backend` job uses Python 3.14, uv 0.12.9, `uv sync --locked`, Ruff format and lint checks, mypy, and pytest.

The `frontend` job uses Node 22.22.2, pnpm 10.8.0, `pnpm install --frozen-lockfile`, Prettier, ESLint, TypeScript, Vitest, and the Next.js build.

Docker Compose is not exercised by this workflow.

## Recorded clean-clone evidence

The following evidence was captured on 2026-09-09 from a clean isolated clone of the target commit on macOS arm64.

| Check | Result | Evidence |
| --- | --- | --- |
| Checkout | Pass | `git status --short --branch` reported `## test/m0-clean-clone-qa-ci-baseline...origin/ci/quality-gates` with no changed files. |
| Tool versions | Pass | uv `0.12.9`, Python `3.14.0`, Node `v26.8.1`, pnpm `10.8.0`, and Docker Compose `v5.5.0`. |
| Backend dependency install and quality | Blocked | `uv sync --locked` required `ast-serialize==0.9.0`, but sandbox DNS could not resolve `files.pythonhosted.org`; no lint, type, test, or HTTP claim is made. |
| Frontend dependency install and quality | Blocked | `pnpm install --frozen-lockfile` could not resolve `registry.npmjs.org`, including `next-16.3.4.tgz`; no formatting, lint, type, test, or build claim is made. |
| Compose configuration | Pass | `docker compose config --quiet` exited 0. |
| PostgreSQL runtime | Blocked | Docker access was denied at `unix:///Users/stroescu/.docker/run/docker.sock`; the image, health check, and SQL probe were not executed. |
| CI execution | Not inspected | This local record verifies workflow mapping only and does not claim a remote CI result. |

The blocked checks are environmental limits, not passing results and not evidence of a product defect.

Re-run the matrix in a network-enabled environment with Docker daemon access, then replace the relevant rows with command output, exit codes, and CI URLs.

## Roadmap boundary

Passing this document establishes only the executable foundation described above.

Milestone 1 is responsible for repository registration and safe read access.

All agent, model, MCP, sandbox, proposal, approval, application, audit, and production-readiness claims remain roadmap work until their own implementation and acceptance evidence exist.
