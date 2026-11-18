# ADR 0013: Pin and bound pull request review context

**Status:** Implemented

## Decision

PR review is a separate read-only application flow from the deterministic Inspect demo. It loads an owned repository, reserves an owner-scoped run identity and pins PR metadata, patches and temporary source to the same head SHA. Rechecking base/head metadata across pagination rejects a moving PR. It never changes the registered snapshot or its sessions.

Context preparation uses confined file reads, deterministic dependency hints and bounded excerpts. Python AST and lexical import edges help select callers, dependencies and matching tests. They are retrieval hints, not a semantic proof or a substitute for source. Coverage and omissions travel with the packet. Core context that exceeds its limit fails explicitly. No repository code or detected command executes.

One bounded completion request goes through the OpenRouter adapter. The API key remains backend-only. Untrusted titles, descriptions, patches and source stay in the data message behind the existing untrusted-data policy. Common credential patterns are redacted, while filenames still obey the established confinement rules. The adapter requests no-collection and zero-retention routing and never weakens those filters on failure. A dedicated operator-controlled key spending limit remains necessary because there is no monthly per-user billing quota in this slice.

Simulation is a deliberate configuration with explicit UI and answer disclaimers. It runs real context preparation without inference. It never silently stands in for a failed real review. Model quality is evaluated separately from no-network protocol tests.

## Streaming and persistence

The POST stream sends progress, public answer deltas and a terminal result. `no-store, no-transform` prevents caching and compression-induced buffering through the same-origin proxy. No reasoning fields are exposed. Markdown renders through a safe AST without raw HTML or image fetching; code copying is a browser action only.

A unique owner/request index and owner-row lock prevent a repeated request from buying another completion or running multiple reviews for one owner. Partial visible text is checkpointed and the terminal answer uses the existing persisted-run event model. Disconnect cancellation preserves the latest checkpoint and closes the provider request. Request-owned temporary source remains alive until confined workers finish. A process crash may lose text since the last checkpoint; it does not imply successful review completion.

Completed request replays return their saved result. A new button click uses a new request identity. Stored PR number and head SHA identify the reviewed revision when a session is restored. Review suggestions do not authorize patch application, GitHub comments, tests or writes.

## Validation

HTTP adapter tests cover PR revision races and path filtering. Application tests cover confinement, graph retrieval and secret fragmentation. End-to-end session tests cover authentication/CSRF, persistence, idempotent replay and partial failures. Provider transports are mocked; browser fixtures exercise actual streaming through the Next rewrite and desktop/mobile restoration. No paid inference is required by any quality gate.
