# Publish an owner-approved fix from a pull request

Repo Surgeon's optional GitHub App bot turns a GitHub inline **suggested change** into a tested commit on a new branch. A review finding from chat can be turned into a suggestion in **Files changed**. The bot takes one suggestion at a time. The workspace chat and its MCP tools retain read-only access.

## What the repository owner does

1. Open an existing PR in a personally owned repository. Both branches must belong to that repository. On the current right-hand diff, use **Add a suggestion** and submit the review comment.
2. Copy the suggestion's link. The number following `discussion_r` is its comment ID. In the PR's **Conversation**, post `/repo-surgeon preview COMMENT_ID`.
3. Read the bot's unified diff, tested file, pinned PR head and destination branch. To approve, post the exact **approve** command from its reply. The bot verifies the current revision and reruns the selected test.
4. To publish, post the separate **apply** command from the approval reply. The bot checks the owner’s two original comments and the PR revision, tests the fix and returns a commit link. The new branch is named `repo-surgeon/fix-<pr>-<revision>`. You decide whether to incorporate it.

To withdraw approval before applying, delete the approval comment. A changed suggestion, head SHA, test file or test image requires a new approval. Retrying the same Apply resolves to the same published branch and commit. A conflicting branch blocks publication.

## Connect one personally owned repository

Use a dedicated GitHub App installation for the bot. Install it on **Only select repositories** and select the target. The service scopes each token to one numeric repository ID. Keep the workspace's existing read-only installation for repository browsing.

| GitHub App setting | Value |
| --- | --- |
| Repository permissions | **Contents: Read and write**, **Issues: Read and write** (PR conversation replies), **Pull requests: Read-only**, Metadata read |
| Subscribe to events | **Issue comment** (includes the PR Conversation tab) |
| Webhook URL | Your HTTPS endpoint ending in `/github/events` |
| Webhook secret | A random server-side secret of at least 32 bytes |
| User authorization | Installation authentication using the App's private key |

GitHub delivers PR conversation commands through the [Issue comment webhook](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_comment). For an existing installation, the owner must accept new permissions in GitHub. Use a dedicated service process with access to its key, Docker and persistent local storage. Keep the private key owner-readable only. The four `REPO_SURGEON_GITHUB_APP__...` settings are documented in the [GitHub App setup](../../README.md#local-github-app-access).

Set the following in the bot process environment:

| Variable | Value |
| --- | --- |
| `REPO_SURGEON_FIX_WEBHOOK_SECRET` | The same secret configured on GitHub |
| `REPO_SURGEON_FIX_TEST_IMAGE` | A locally installed, trusted test image ID (`sha256:...` from `docker image inspect --format '{{.Id}}' IMAGE`) |
| `REPO_SURGEON_FIX_TEST_FILE` | Repository-relative path to a selected pytest, Vitest or Node built-in test file |
| `REPO_SURGEON_REPOSITORY_STORAGE` | Path under a private, persistent service directory. Delivery and approval records live in a sibling `fix-bot/<repository-id>/` directory. |

From `backend/`, with the locked dependencies installed:

```sh
uv run uvicorn repo_surgeon.fix_webhook:create_app --factory --host 127.0.0.1 --port 8012 --workers 1
```

Route only `POST /github/events` from your HTTPS reverse proxy to that listener. Use one service process per configured installation repository. Open **GitHub App settings > Advanced > Recent deliveries** to check delivery status. A signed ping returns 204. Accepted commands return 202 and are saved before processing. Pending jobs resume on restart. If GitHub or Docker is unavailable, check the PR reply and service log. Redeliver a failed event or post a fresh command after correcting the cause.

## Test and publication boundaries

- The proposal may edit an existing, regular Python, JavaScript or TypeScript source file of up to 64 KiB. It must use UTF-8 with LF endings. Hidden and sensitive paths, binary files and ambiguous suggestions are rejected.
- The network-disabled, non-root container receives a read-only disposable snapshot, a small writable temporary directory, one CPU, 512 MiB of memory and a 90-second timeout. Preinstall the selected runner and dependencies in an image without secrets. Supported tests are pytest (`test_*.py` or `*_test.py`) and Node's built-in test runner (`*.test.js`, `*.test.mjs`, `*.test.cjs`). A package declaring Vitest uses the fixed `/node_modules/.bin/vitest run` entry point from the trusted image. Install its reviewed, locked dependencies under `/node_modules`. For the bookstore backend select `backend/server.test.mjs`.
- A successful test covers the selected file. It does not certify the entire PR. GitHub Actions in the target repository may also run when the new branch is published.
- Publication uses a commit with the reviewed head as its sole parent. Only a new branch reference is created. GitHub can move the PR head independently after the last check. The fix stays pinned to the reviewed parent for the owner's inspection.
- The webhook verifies its HMAC signature, installation, repository and numeric owner ID. Apply rechecks both unedited owner comments on the same PR. Neither a collaborator, a model response nor a public repository import grants approval authority.
