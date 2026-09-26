# ADR 0011: Tenant-scoped persisted read-only agent turns

## Status

Accepted for Stage 0 of Milestone 5.

## Context

The authenticated workspace needs a durable product-session boundary before proposal work can begin. An authentication session is not a conversation session, and a browser-only or in-memory turn would not support reconnecting after a dropped SSE connection. Repository identifiers, sessions, runs, tool calls, and events must also be isolated by the current principal.

## Decision

Expose versioned `/api/v1` routes for owned repositories, product sessions, bounded turns, and persisted run events. Every public-authenticated lookup is owner-scoped and returns the same 404 problem for unknown and foreign identifiers. POST routes require both the exact configured Origin and the current opaque session's CSRF token. The local-trusted mode keeps its existing local principal behavior.

Persist conversation sessions, agent runs, tool calls, and normalized run events in a forward migration after the identity migration. The application runs the existing bounded read-only loop with a credential-free deterministic provider for this slice, stores redacted tool arguments and result summaries, and streams only committed normalized events. `Last-Event-ID` resumes strictly after the matching event in the same owned run.

The connected repository remains a read source. The Stage 0 turn has no proposal, diff, sandbox, approval, apply, branch, or pull-request capability, and the end-to-end contract proves repository bytes and Git status are unchanged.

## Alternatives considered

- Accept a model-authored turn or diff through a separate public endpoint: reject. It would create a second authorization and audit path before the session/run boundary exists.
- Keep turns in browser or process memory: reject. Reconnection and durable audit semantics would be impossible to guarantee.
- Allow repository or session IDs supplied by the provider: reject. Trusted tenant and repository context is injected by the application and looked up owner-first.

## Consequences

The product has an explicit conversation aggregate separate from auth sessions, and SSE becomes a projection of durable normalized events. The extra persistence records make ownership and resume testable, while the deterministic provider keeps ordinary tests network- and credential-free. Proposal state, diff parsing, sandboxing, and all write controls remain later milestones.

## Review trigger

Revisit when a real provider is enabled, when concurrent turns or live cancellation are required, or when the proposal capability is added behind the same run-bound application seam.
