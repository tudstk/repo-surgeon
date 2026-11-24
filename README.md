# Repo Surgeon

![A magnifying glass inspects a globe made of source code. Review the change. Keep the context.](docs/assets/repo-surgeon-banner.png)

**Review pull requests with the surrounding code in view.** Open a GitHub PR, read its diff alongside the repository, and select **Code Review this PR**. Repo Surgeon gives the model the PR title, description, pinned diff and relevant source excerpts so you can judge whether the change solves the stated problem and where it needs work.

## Inside the workspace

- **Read the change.** Import a public GitHub repository, browse open or closed pull requests, and switch between unified and side-by-side diffs.
- **Follow the evidence.** A bounded dependency map helps select related source for the review. Browse files, branches and earlier commits to check a finding yourself.
- **Ask a follow-up.** Repository chat uses your saved snapshot and recent conversation. Reviews identify the PR revision they examined. Responses stream into the workspace with copyable code blocks.

### Tools and models

Repo Surgeon's Python **FastMCP** tools let the read-only agent list visible paths with `list_files`, read bounded excerpts with `read_file`, and locate matching code with `search_code`. They run in-process and enforce the registered repository boundary. A separate GitHub adapter retrieves PRs and diffs. [Read about the tool limits](docs/mcp/safe-search-tools.md).

Choose **DeepSeek V3.2** (`deepseek/deepseek-v3.2`, default) or **DeepSeek V4 Flash** (`deepseek/deepseek-v4-flash`, budget) in the composer. Live requests send selected repository context to OpenRouter using a backend-only key. Explicit simulation lets you try the interface without spending credits. [Model setup and context limits](docs/learning/pr-code-reviews.md).

Reviews are advisory. The review action reads source and saves the response to your session. Running tests, approving a fix and publishing a commit are separate operations outside this release's review flow.

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

In the workspace, choose **Add repository**, search by repository name or exact `owner/repository`, then select a suggestion. After import, the snapshot is selected and ready for a read-only session. Its short commit identifier appears in the repository list. Reloading restores the saved registration. Ask questions about the imported snapshot in the composer, or open a PR to review its pinned revision.

The backend checks public visibility without a GitHub token, resolves the default branch to a commit and downloads a bounded source ZIP into app-managed storage. Set `REPO_SURGEON_REPOSITORY_STORAGE` to a private, persistent directory owned by the backend process; its default is `~/.local/share/repo-surgeon/repositories`. Back up this directory together with the database. Multiple workers must share the same filesystem. The Next.js API proxy allows 90 seconds for import responses; any outer proxy needs a compatible timeout. The browser never supplies a filesystem path.

Imports allow at most 25 MiB downloaded ZIP data, 100 MiB expanded source, 10,000 archive entries, 64 path components and 1,024 characters per archive path. Symlinks, special files, Git internals, encrypted archives and conflicting names are rejected. There are two concurrent imports per process, with a 60-second queue/network deadline; bounded extraction finishes cleanup before a timed-out operation releases its slot. Same-account, same-commit retries reuse the saved snapshot. Importing a newer commit creates another snapshot and leaves existing sessions intact.

The source snapshot contains a pinned source tree. Branch and commit history are fetched on demand from GitHub. Submodule contents are omitted, and Git LFS content depends on GitHub's archive settings. The service has per-import bounds. Deployments must monitor storage because cumulative tenant quotas and automatic retention are deferred. If persistence fails after publication, a complete unregistered snapshot can remain and a retry reuses it. Keep registered snapshot directories while sessions refer to them.

Deterministic coverage lives in `backend/tests/test_github_import.py`, `frontend/src/app/github-repository-picker.test.tsx` and `frontend/e2e/workspace.spec.ts`. These checks use fixtures and make no paid model calls.

Repository search accepts an owner prefix such as `tudstk/` and a partial repository name such as `tudstk/repo`. Import errors show the specific server-reported cause. Size errors distinguish the compressed download limit (25 MiB) from the expanded source limit (100 MiB); when the download must stop before its total is known, the message reports measured bytes as a lower bound.

Language percentages use detected source-file bytes from the confined, bounded file listing, excluding ignored directories. They are independent of the weighted primary-language confidence heuristic and do not claim GitHub Linguist parity. Local Devicon assets provide language logos without browser requests to third parties.

Each repository has a three-dot actions menu. **Remove** opens a confirmation for the repository and its associated sessions. Confirming hides it from your workspace list; it does not delete source snapshots, saved sessions or anything on GitHub. **Undo removal** restores the last removed entry. Importing the same public repository commit again also restores its entry. Visibility changes are owner-scoped and require the same CSRF protection as other workspace mutations.

Selecting an imported snapshot checks the commit on GitHub's default branch. Look in the upper-right corner of **Code** for the saved revision and remote status. **Up to date** means the saved revision matches. If it differs, **Behind GitHub** and **Sync** appear. Sync checks again before downloading, updates the existing repository entry, and keeps its saved sessions. If an earlier sync created a duplicate, sync the older entry to consolidate it and preserve sessions from both entries. Use the refresh icon to check again while staying on the same snapshot.

For an imported GitHub repository, use the branch picker in **Code** to preview the tip of another branch. Open the commit picker for that branch to browse older pages and select a revision. The commit picker shows the subject, and any message body appears directly beneath it. Choose **Saved snapshot** in the commit picker to return to the source used by the workspace and its sessions. A history selection is a read-only preview. GitHub API rate limits and the existing source-archive limits apply.

### Browse pull requests

Select an imported repository and open **Pull Request** in the right work pane. On a phone, open **Repository tools** first. **Open** lists open and draft pull requests. **Closed** includes closed and merged pull requests. Select a pull request, choose a changed file, and switch between **Unified** and **Side by side**. The viewer shows GitHub's available text patches with file paths, change counts, and original and new line numbers.

Lists and file changes load one page at a time. The viewer identifies missing or partial text patches and applies the workspace's protected-path and preview limits. Use the GitHub link in the pull request header to see the upstream comparison. The **Code Review this PR** control is disabled while review execution is deferred.

### Local GitHub App access

In loopback-only `local_trusted` mode, a GitHub App installation can read GitHub history and Sync for one existing snapshot, including a repository that became private after it was imported. Those requests use the installation's [GitHub API quota](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-github-app-installations). Repository search and new imports still use the public endpoints and their own rate limits.

1. [Register a GitHub App](https://github.com/settings/apps/new) for your own account. Disable webhooks, grant **Contents → Read-only** and use GitHub's required read-only metadata permission. Leave all event subscriptions empty.
2. Install the App with **Only select repositories** and select the repository that matches your saved snapshot.
3. Generate the App's PEM key and keep it outside the checkout with file permissions `0600`. Use the App ID from its settings and the installation ID from the installation page URL. To find the GitHub repository's numeric ID, run `gh api repos/OWNER/REPOSITORY --jq .id` while signed in to GitHub CLI.
4. Add these values to the backend's private runtime environment and restart it.

```dotenv
REPO_SURGEON_GITHUB_APP__APP_ID=123
REPO_SURGEON_GITHUB_APP__INSTALLATION_ID=456
REPO_SURGEON_GITHUB_APP__REPOSITORY_ID=789
REPO_SURGEON_GITHUB_APP__PRIVATE_KEY_PATH=/absolute/path/outside/the/checkout/github-app.pem
```

Open the existing repository in **Code**. The branch picker can now read GitHub history for that snapshot. The server mints a read-only token for the configured numeric repository ID and keeps it in process memory. For private pull request browsing, also grant **Pull requests → Read-only** in the App registration and approve the permission on the installation. Pull request reads use their own token scoped to that single permission and repository.

If the workspace cannot open an imported snapshot after a filesystem remount, choose **Recover snapshot**. The server compares the existing directory with a fresh bounded archive of the saved public commit. Recovery updates its filesystem binding only when the original directory and files match. The repository and its saved sessions keep their IDs. A missing or changed snapshot requires a fresh import or operator assistance.

New session names use the repository name without its GitHub owner. Repeated names get a numeric suffix such as `-1`. Use the session row’s three-dot menu to rename it or confirm removal. Removal archives the session and keeps its saved history.

The workspace opens the **Code** tab by default. Expand folders in **Files** and select a file to see its repository-relative path, line numbers, and syntax highlighting for supported languages. At the end of the loaded lines, use **View more** to append the next batch and **Activity** for saved run events. Drag the desktop divider to resize the pane between 20% and 50% of the viewport. On phones, open **Code & activity** and use **Files** to return to the tree.

Folder listings are fetched on demand in pages of 100, with a scan cap of 10,000 entries per directory. Previews support UTF-8 and BOM-marked UTF-16/32 text up to 64 KiB, 500 lines at a time. Protected paths, binary files, and oversized files are excluded from previews.

## Pull request code reviews

The Pull Request tab sends **Code Review this PR** into the session, streams Markdown with copyable code blocks, and saves the PR revision with its answer. Set `REPO_SURGEON_REVIEW_MODE=simulation` to exercise this without paid inference. OpenRouter reviews require a backend-only API key. Run the normal migrations first; `20261118_0007` adds nullable review metadata and a retry identity without altering repository ownership or existing turns. See [setup, MCP capabilities, context limits and pricing](docs/learning/pr-code-reviews.md).
