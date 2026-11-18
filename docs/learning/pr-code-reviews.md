# Pull request reviews and OpenRouter

The Pull Request tab can send the exact message **Code Review this PR** into the selected session. If none exists, the workspace creates one first. The response streams into the conversation with Markdown, syntax-highlighted code and Copy code controls. Stop review cancels the connection. Saved review metadata identifies the PR and head SHA; restoring a session shows its latest exchange.

## Try it without paying

Run migrations with your usual private environment, then start the backend with:

```sh
REPO_SURGEON_REVIEW_MODE=simulation uv run --locked uvicorn repo_surgeon.main:app --reload --host 127.0.0.1 --port 8000
```

Use your deployment's normal environment loading and API port. Open a repository, choose **Pull Request**, select a PR, then **Code Review this PR**. A Simulation badge and explicit disclaimer distinguish the example from a real assessment. Simulation still fetches actual GitHub PR context, prepares its map and persists the result. It makes no inference request. Ordinary chat messages use the selected model with saved-snapshot context, or a labelled simulation in simulation mode.

## Enable a real model

1. Create an [OpenRouter account](https://openrouter.ai/), purchase a small credit balance and create a dedicated API key with a spending limit in [Keys](https://openrouter.ai/settings/keys).
2. Put the following only in the private environment loaded by the backend. Never commit the key, paste it into chat, or use a `NEXT_PUBLIC_` variable.

   ```dotenv
   REPO_SURGEON_OPENROUTER_API_KEY=replace_with_your_private_key
   REPO_SURGEON_OPENROUTER_MODEL=deepseek/deepseek-v3.2
   REPO_SURGEON_REVIEW_MODE=openrouter
   ```

3. Restart the backend, removing any process-level simulation override, and reload the workspace. Missing configuration fails explicitly rather than silently switching to simulated findings.
4. Choose **DeepSeek V3.2 · Default** or **DeepSeek V4 Flash · Budget** in the chat composer, then select a PR and start a review. The choice applies to the next PR review and is locked while a request runs. That action sends its bounded context to OpenRouter and an eligible inference provider. Check your OpenRouter activity and credit usage after the first real review.

Only the two server-owned model IDs are accepted. Changing the selection does not send a request. The composer also answers ordinary repository questions with the selected model. The API key stays on the backend. The adapter requests providers with `data_collection: deny`, `zdr: true` and `require_parameters: true`. Availability depends on those filters. This is a routing policy, not a claim that code never leaves your computer. See [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## Tokens and prices

A token is a small text unit, often a word fragment or punctuation. One million tokens is roughly 750,000 English words; source code varies substantially. Input tokens include instructions, title, description, patches, map and excerpts. Output tokens cover the generated response and any billable reasoning. A token limit is not a character limit.

Catalog prices checked on 2026-11-18 through the [OpenRouter model API](https://openrouter.ai/api/v1/models):

| Model | Input / million tokens | Output / million tokens | Example: 30,000 input + 3,000 output | 100 such reviews |
| --- | ---: | ---: | ---: | ---: |
| [DeepSeek V3.2](https://openrouter.ai/deepseek/deepseek-v3.2) | $0.26 | $0.38 | $0.00894 | $0.894 |
| [DeepSeek V4 Flash](https://openrouter.ai/deepseek/deepseek-v4-flash) | $0.09 | $0.18 | $0.00324 | $0.324 |

DeepSeek V3.2 remains the default. V4 Flash is the cheaper selectable alternative; neither label guarantees review quality. Routing caps are $0.30/$0.50 per million input/output tokens for V3.2 and $0.12/$0.25 for V4 Flash. These caps prevent routing above those rates but do not impose a monthly spending budget. No live model quality evaluation is performed by the automated suite.

Cost = input tokens / 1,000,000 × input rate + output tokens / 1,000,000 × output rate. These examples exclude credit-purchase fees, caching discounts, provider variation and extra billable reasoning. OpenRouter currently lists a 5.5% Standard credit-purchase fee; review the [current checkout and pricing](https://openrouter.ai/pricing) before buying. Provider prices can change.

## Repository context and its limits

The service fetches the PR title, description and file patches, checks that the PR revision did not change during pagination, and downloads its exact head commit to temporary storage. It does not review the older saved workspace snapshot. The temporary archive uses the existing fixed-host download and extraction policy. No repository script or detected test command runs.

A local deterministic map plays the retrieval role suggested by Graphify, without requiring Graphify installation or another model call. Python files use AST imports and top-level declarations. JavaScript and TypeScript use lexical imports and declarations; other source types have limited lexical hints. The map selects changed files, their direct dependencies and callers, matching tests and manifests. It is not a whole-program call graph and can miss aliases, dynamic imports, runtime calls and unsupported languages. Deleted files rely on their patch rather than a head-source excerpt.

Bounds are explicit: at most 60 changed file entries, 1,000 visible paths, 300 directories and 4 MiB of scanned source. Each source file follows the existing 64 KiB read limit. Selected excerpts include up to 160 lines around each of four changed hunks. The serialized context is capped at 140,000 ASCII characters, with a 24,000-character map budget. Large patches may be limited by the existing diff policy; oversized core PR context fails rather than silently dropping the PR. The response reports coverage and omissions. A graph guides source selection; it does not replace code or prove correctness.

Repository reads use the same confinement policy as the MCP tools. Hidden credential paths and symlinks are excluded; common credential patterns are redacted before sending and saving. Pattern redaction cannot guarantee that arbitrary source contains no sensitive information.

## Existing MCP capabilities

`list_files`, `read_file` and `search_code` are the three registered FastMCP file tools. Reads and literal search are typed, confined and bounded. The current process exercises them in-process; no standalone MCP transport is started. GitHub search/import, Sync, history and PR browsing use separate application HTTP adapters. The review context map is an application service, not an additional exposed MCP tool.

There are no model-accessible shell, write, merge, patch-application or sandbox-execution tools in this flow. Reviews suggest improvements but do not modify a repository or post comments to GitHub.

## Persistence, failures and verification

Migration `20261118_0007` adds nullable review metadata and an owner-scoped unique request identity to agent runs. A repeated completed request replays the saved answer without another provider call. Reusing its identity for a different model is rejected. The requested model and actual usage remain attached to the saved run. Only one review per owner may run concurrently. Failed, stopped and disconnected streams preserve a checkpointed partial answer; very recent text can be lost on a process crash. Retrying a failed request identity replays that failure; a new click starts a new review.

The default total timeout is 180 seconds and output budget is 4,000 tokens. Operators can set `REPO_SURGEON_REVIEW_TIMEOUT_SECONDS` between 30 and 300 and `REPO_SURGEON_REVIEW_MAX_OUTPUT_TOKENS` between 512 and 8,000. One review makes one completion request and never retries inference automatically. Model reasoning fields are not displayed. Whitelisted token/cost usage is retained in saved review metadata; inspect OpenRouter activity for authoritative billing.

Tests use synthetic fixtures, disposable SQLite databases and HTTP mock transports. Browser tests exercise actual chunked streaming through the same-origin Next proxy, Markdown safety, responsive layout and restored review context. Provider failures, redaction across split chunks, PR revision races and request replay are covered without a paid API key. Manual live checks are separate from the automated suite; see the [model-selector validation record](../reviews/live-review-model-selector/README.md). A smoke test is not a model-quality benchmark.


## Repository questions and follow-ups

Write a message in the one-line composer and click its upward arrow. The input grows with wrapped text and newlines, up to 180px, then scrolls internally. A session is created if necessary. **Chat model** selects the same allowlisted provider choices for ordinary questions and PR reviews. No inference request occurs until Send or Code Review this PR is clicked.

Repository messages use `POST /api/v1/sessions/{id}/repository-messages` with a message, UUID request identity and optional model ID. They stream through the same authenticated, CSRF-protected, owner-scoped persistence and cancellation flow as PR reviews. Changing a question or model while reusing a request identity fails. The latest answer restores on reload; the UI still shows the latest exchange rather than a full transcript.

Questions read the registered saved snapshot, not a branch/commit preview or live GitHub head. The response labels that snapshot. Selection uses up to 48 lexical query terms from the question and two recent questions, ranks up to eight source files, then includes bounded dependency/caller hints and manifests. Reads share the PR mapper's confinement, 4 MiB scan and 140,000-character packet bounds. Four recent completed exchanges provide follow-up context, capped at 2,000 question and 3,000 answer characters each. Redaction runs before any packet is sent externally. This retrieval is heuristic and can miss relevant source; the model must acknowledge absent evidence. It cannot execute code, tests, edit files or post to GitHub.

The old `/turns` endpoint remains a deterministic read-only demo for existing clients and no-network tests. Backends advertise ordinary model chat through the authenticated provider capability response. The current workspace uses it whenever available; it never falls back to simulation after a live provider failure.
