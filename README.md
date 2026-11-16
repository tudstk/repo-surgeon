# Repo Surgeon

Repo Surgeon is a local-first, human-controlled coding assistant for understanding and safely changing Git repositories.

## Implemented status

This checkout provides an executable foundation: a typed FastAPI process, a strict TypeScript and Next.js frontend, local PostgreSQL through Docker Compose, and CI quality gates. It also registers an existing local Git working tree and persists its resolved canonical root. The backend includes bounded read-only file and exact-search tools, deterministic repository intelligence, a deterministic model-provider agent loop, a bounded bug-investigation workflow, and the authenticated persisted-turn seam. The frontend includes GitHub login and profile screens plus a tenant-scoped three-pane workspace for one bounded read-only turn.

Registration validates only the selected path and Git worktree boundary. The MCP tools read and search bounded safe content, and the agent loop can use only those read-only capabilities through a provider boundary. Repository intelligence maps bounded manifest evidence to versioned language and test-command catalogs without executing repository code. Bug investigations use a fixed bounded search plan and, for the canonical seeded fixture, an evaluation-owned deterministic behavioral proof; unsupported questions return insufficient evidence. Authenticated users can select an owned repository, create a product session, submit one deterministic read-only turn, and resume its persisted normalized SSE events. There is still no HTTP MCP transport, repository indexing, URL cloning, repository mutation, sandbox, patch workflow, or approval system. Local-trusted repository behavior remains available only through the existing local boundary; public-authenticated workspace requests use the current principal and fail closed for foreign IDs. See [safe search](docs/mcp/safe-search-tools.md), [product scope](docs/product/scope.md), and [persisted turns](docs/architecture/decisions/0011-persisted-agent-turns.md).

No model API key is required.

### Workspace interface

A public landing-page preview is available at `/landing`; the working workspace remains at `/`. The shared brand returns to the landing page. The hero and sign-in screen share a faint circuit texture with two introductory accent pulses and mouse-triggered pulses. Reduced-motion preference keeps it static.
The landing page uses locally hosted type and actual UI captures with synthetic demo data. It makes no model calls and loads no private workspace records.

The workspace’s **Add repository** dialog searches public GitHub repositories by name or `owner/repository`, with owner avatars. Select a result to import its default branch at a pinned commit as a read-only source snapshot. Search and download use credential-free GitHub endpoints and may be rate-limited. Private repositories are not supported.

GitHub sign-in identifies your account; it does not connect or import your GitHub repositories.
The workspace shows your imported snapshots and any local repositories already assigned to your account.
Its demo provider lists files and returns a fixed completion message, rather than a tailored answer.
Selecting a saved session restores its latest exchange and run events, not a complete transcript.
“Persisted” means saved to session history; it does not mean a Git commit was created or a tool succeeded.

The interface uses three fixed desktop panes with plain dividers and conversation-first drawers at 1100px and below.
The light palette follows the operating system preference; keyboard focus and reduced motion are supported.
The top-right GitHub avatar shows the username on hover and opens Profile/Settings navigation. Settings currently explains the fixed defaults; it has no editable controls.
The four unfinished direct URLs explain their availability and link back to the workspace.
See the [design system](DESIGN.md), [product context](PRODUCT.md) and the [interface learning note](docs/learning/workspace-interface.md).

## Access modes and authentication foundation

The checked-in default is `local_trusted`: the API accepts loopback clients and
the existing bounded local-repository workflow remains available. It is not a
public deployment configuration. Set `REPO_SURGEON_ACCESS_MODE=public_authenticated`
only with runtime-injected OAuth and encryption settings,
`REPO_SURGEON_COOKIE_SECURE=true`, an exact `REPO_SURGEON_PUBLIC_ORIGIN`, and
`REPO_SURGEON_LOCAL_REPOSITORY_ACCESS=false`. The typed settings contract rejects
wildcard origins in every mode, and rejects unsafe callback URLs, incomplete
public configuration, and production use of local defaults.

Milestone 4.5C adds FastAPI-owned identity-only GitHub OAuth endpoints:
`GET /api/v1/auth/github/start`, `GET /api/v1/auth/github/callback`,
`GET /api/v1/auth/session`, and `POST /api/v1/auth/logout`. They use one-time,
browser-bound PKCE state and an opaque HttpOnly session cookie. GitHub tokens are
used only in process to retrieve a single safe profile snapshot and are never
persisted or sent to the browser. In secure public settings the cookie is
host-prefixed (`__Host-repo_surgeon_session`), Secure, HttpOnly, `SameSite=Lax`,
and has no persistent `Max-Age`. HTTP-only local development uses distinct,
non-prefixed cookie names; public mode and production reject insecure cookies.

Public mode still rejects every local-repository endpoint at the FastAPI boundary.
The frontend provides a GitHub identity journey at `/login`, `/auth/callback`, and
`/profile`, followed by a tenant-scoped read-only workspace at `/`. It uses the
FastAPI-owned opaque browser session and keeps its CSRF token only in component
memory. Repository connections are read-only and authenticated access is
owner-scoped.

The security rationale and required negative-test matrix are in the
[authentication ADR](docs/architecture/decisions/0010-github-authentication-and-tenancy-foundation.md)
and [threat model](docs/security/authentication-threat-model.md).

## Prerequisites

- Python 3.14.x and [uv](https://docs.astral.sh/uv/) 0.12.9.
- Node.js 22.22.2 or newer in the 22.x line and pnpm 10.8.x. The supported ranges are in [frontend/package.json](frontend/package.json).
- ripgrep 14.1 or newer for bounded repository search.
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

With the checked-in `local_trusted` default, the API listens on `127.0.0.1:8000`
and rejects non-loopback clients. Repository metadata and source search are
unauthenticated within this local development trust boundary, so do not expose
the process through a proxy, container port, or non-loopback bind. In another
terminal, run the health checks:

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

Open <http://127.0.0.1:3000/login>. The browser uses same-origin `/api/*` URLs;
Next.js proxies them to FastAPI at `REPO_SURGEON_API_ORIGIN` (default:
`http://127.0.0.1:8000`). This includes the GitHub callback, so the HttpOnly,
`SameSite=Lax` session cookie remains usable after OAuth redirects. The callback
page resolves only the opaque browser session before showing the safe profile
projection at `/profile`. FastAPI always redirects callback completion to the
validated fixed frontend destination, rather than resolving it from an API-origin
relative path. Repository requests begin only after the workspace confirms the browser session;
the API enforces account ownership for repository and session reads.

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
pnpm test:e2e
pnpm build
```

The workflow runs on pushes and pull requests. It uses `backend/uv.lock` and `frontend/pnpm-lock.yaml`, then checks backend formatting, linting, strict typing, and tests plus frontend formatting, linting, type checking, unit tests, browser E2E tests, and production build.

## Learn the foundation

The identity request path is `browser -> same-origin Next.js /api proxy -> Uvicorn ASGI server -> FastAPI authentication router -> application use case -> PostgreSQL`, with GitHub profile retrieval isolated behind the OAuth adapter. The workspace path adds owner-scoped repository lookup, product-session persistence, a bounded fake-provider turn, normalized run-event persistence, and resumable SSE. Read the [architecture baseline](docs/architecture/overview.md), [C# and Python concept map](docs/learning/glossary.md), and [Milestone retrospectives](docs/learning/milestone-retrospectives.md).

Future work continues with Git context, test sandboxing, proposals, approvals, patch application, audits, and pull requests. The provider boundary and in-process MCP tools support only bounded read-only workflows; they are not connected to write or sandbox workflows.

## Public repository imports

Run the normal `uv run alembic upgrade head` migration before starting this version. Migration `20261114_0005` adds nullable snapshot provenance fields and preserves existing registrations and ownership. Migration `20261114_0006` adds persistent workspace visibility; existing repositories remain visible.

In the workspace, choose **Add repository**, search by repository name or exact `owner/repository`, then select a suggestion. After import, the snapshot is selected and ready for a read-only session. Its short commit identifier appears in the repository list. Reloading restores the saved registration. The deterministic demo provider still lists files and returns its fixed completion message.

The backend checks public visibility without a GitHub token, resolves the default branch to a commit and downloads a bounded source ZIP into app-managed storage. Set `REPO_SURGEON_REPOSITORY_STORAGE` to a private, persistent directory owned by the backend process; its default is `~/.local/share/repo-surgeon/repositories`. Back up this directory together with the database. Multiple workers must share the same filesystem. The Next.js API proxy allows 90 seconds for import responses; any outer proxy needs a compatible timeout. The browser never supplies a filesystem path.

Imports allow at most 25 MiB downloaded ZIP data, 100 MiB expanded source, 10,000 archive entries, 64 path components and 1,024 characters per archive path. Symlinks, special files, Git internals, encrypted archives and conflicting names are rejected. There are two concurrent imports per process, with a 60-second queue/network deadline; bounded extraction finishes cleanup before a timed-out operation releases its slot. Same-account, same-commit retries reuse the saved snapshot. Importing a newer commit creates another snapshot and leaves existing sessions intact.

This is a source snapshot, not a Git checkout: history, automatic refresh, permanent deletion, private repositories and Git write actions are unavailable. Submodule contents are not fetched, and Git LFS content depends on GitHub's archive settings. GitHub's unauthenticated rate limits apply. The service has per-import bounds, but no cumulative tenant storage quota or automatic retention policy yet; deployments must monitor storage. If persistence fails after publication, a complete unregistered snapshot can remain and a retry reuses it. Never delete registered snapshot directories while sessions still refer to them.

Deterministic coverage lives in `backend/tests/test_github_import.py`, `frontend/src/app/github-repository-picker.test.tsx` and `frontend/e2e/workspace.spec.ts`. These checks use fixtures and make no paid model calls.

Repository search accepts an owner prefix such as `tudstk/` and a partial repository name such as `tudstk/repo`. Import errors show the specific server-reported cause. Size errors distinguish the compressed download limit (25 MiB) from the expanded source limit (100 MiB); when the download must stop before its total is known, the message reports measured bytes as a lower bound.

Language percentages use detected source-file bytes from the confined, bounded file listing, excluding ignored directories. They are independent of the weighted primary-language confidence heuristic and do not claim GitHub Linguist parity. Local Devicon assets provide language logos without browser requests to third parties.

Each repository has a three-dot actions menu. **Remove** opens a confirmation for the repository and its associated sessions. Confirming hides it from your workspace list; it does not delete source snapshots, saved sessions or anything on GitHub. **Undo removal** restores the last removed entry. Importing the same public repository commit again also restores its entry. Visibility changes are owner-scoped and require the same CSRF protection as other workspace mutations.

If the workspace cannot open an imported snapshot after a filesystem remount, choose **Recover snapshot**. The server compares the existing directory with a fresh bounded archive of the saved public commit. Recovery updates its filesystem binding only when the original directory and files match. The repository and its saved sessions keep their IDs. A missing or changed snapshot requires a fresh import or operator assistance.

New session names use the repository name without its GitHub owner. Repeated names get a numeric suffix such as `-1`. Use the session row’s three-dot menu to rename it or confirm removal. Removal archives the session and keeps its saved history.

The workspace opens the **Code** tab by default. Expand folders in **Files** and select a file to see its repository-relative path, line numbers, and syntax highlighting for supported languages. At the end of the loaded lines, use **View more** to append the next batch and **Activity** for saved run events. Drag the desktop divider to resize the pane between 20% and 50% of the viewport. On phones, open **Code & activity** and use **Files** to return to the tree.

Folder listings are fetched on demand in pages of 100, with a scan cap of 10,000 entries per directory. Previews support UTF-8 and BOM-marked UTF-16/32 text up to 64 KiB, 500 lines at a time. Protected paths, binary files, and oversized files are excluded from previews.
