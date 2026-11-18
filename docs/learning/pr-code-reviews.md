# Pull request reviews and OpenRouter

The Pull Request tab can send the exact message **Code Review this PR** into the selected session. If none exists, the workspace creates one first. The response streams into the conversation with Markdown, syntax-highlighted code and Copy code controls. Stop review cancels the connection. Saved review metadata identifies the PR and head SHA; restoring a session shows its latest exchange.

## Try it without paying

Run migrations with your usual private environment, then start the backend with:

```sh
REPO_SURGEON_REVIEW_MODE=simulation uv run --locked uvicorn repo_surgeon.main:app --reload --host 127.0.0.1 --port 8000
```

Use your deployment's normal environment loading and API port. Open a repository, choose **Pull Request**, select a PR, then **Code Review this PR**. A Simulation badge and explicit disclaimer distinguish the example from a real assessment. Simulation still fetches actual GitHub PR context, prepares its map and persists the result. It makes no inference request. Ordinary **Inspect** messages continue using the separate deterministic file-listing demo.

## Enable a real model

1. Create an [OpenRouter account](https://openrouter.ai/), purchase a small credit balance and create a dedicated API key with a spending limit in [Keys](https://openrouter.ai/settings/keys).
2. Put the following only in the private environment loaded by the backend. Never commit the key, paste it into chat, or use a `NEXT_PUBLIC_` variable.

   ```dotenv
   REPO_SURGEON_OPENROUTER_API_KEY=replace_with_your_private_key
   REPO_SURGEON_OPENROUTER_MODEL=deepseek/deepseek-v3.2
   REPO_SURGEON_REVIEW_MODE=openrouter
   ```

3. Restart the backend, removing any process-level simulation override, and reload the workspace. Missing configuration fails explicitly rather than silently switching to simulated findings.
4. Select a PR and start a review. That action sends its bounded context to OpenRouter and an eligible inference provider. Check your OpenRouter activity and credit usage after the first real review.

The API key stays on the backend. The adapter requests providers with `data_collection: deny`, `zdr: true` and `require_parameters: true`. Availability depends on those filters. This is a routing policy, not a claim that code never leaves your computer. See [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## Tokens and prices

A token is a small text unit, often a word fragment or punctuation. One million tokens is roughly 750,000 English words; source code varies substantially. Input tokens include instructions, title, description, patches, map and excerpts. Output tokens cover the generated response and any billable reasoning. A token limit is not a character limit.

Catalog prices checked on 2026-11-18 through the [OpenRouter model API](https://openrouter.ai/api/v1/models):

| Model | Input / million tokens | Output / million tokens | Example: 30,000 input + 3,000 output | 100 such reviews |
| --- | ---: | ---: | ---: | ---: |
| [DeepSeek V3.2](https://openrouter.ai/deepseek/deepseek-v3.2) | $0.26 | $0.38 | $0.00894 | $0.894 |
| [Qwen3 Coder](https://openrouter.ai/qwen/qwen3-coder) | $0.30 | $1.00 | $0.012 | $1.20 |
| [Gemini 2.5 Flash](https://openrouter.ai/google/gemini-2.5-flash) | $0.30 | $2.50 | $0.0165 | $1.65 |

DeepSeek V3.2 is the initial inexpensive default, not a quality guarantee. Qwen3 Coder is a coding-oriented alternative worth comparing on the same PRs. No live model quality evaluation was performed by the automated suite.

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

Migration `20261118_0007` adds nullable review metadata and an owner-scoped unique request identity to agent runs. A repeated completed request replays the saved answer without another provider call. Only one review per owner may run concurrently. Failed, stopped and disconnected streams preserve a checkpointed partial answer; very recent text can be lost on a process crash. Retrying a failed request identity replays that failure; a new click starts a new review.

The default total timeout is 180 seconds and output budget is 4,000 tokens. Operators can set `REPO_SURGEON_REVIEW_TIMEOUT_SECONDS` between 30 and 300 and `REPO_SURGEON_REVIEW_MAX_OUTPUT_TOKENS` between 512 and 8,000. One review makes one completion request and never retries inference automatically. Model reasoning fields are not displayed. Whitelisted token/cost usage is retained in saved review metadata; inspect OpenRouter activity for authoritative billing.

Tests use synthetic fixtures, disposable SQLite databases and HTTP mock transports. Browser tests exercise actual chunked streaming through the same-origin Next proxy, Markdown safety, responsive layout and restored review context. Provider failures, redaction across split chunks, PR revision races and request replay are covered without a paid API key. The live manual smoke uses the configured GitHub App and PostgreSQL with simulation enabled. No real assessment or model-quality result is implied by that smoke.
