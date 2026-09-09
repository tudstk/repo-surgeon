# ADR 0005: Persist normalized SSE events before they are streamed

**Status:** Accepted for the first streamed agent run

## Context

Agent output and tool activity are long-running, and browser connections can drop. A transient in-memory stream cannot reliably prove what users saw, resume a run, or support later auditability. Provider event formats must not define the public API.

## Decision

Persist normalized application events before publishing them over SSE. Each event has a stable event identifier, run identifier, monotonically increasing sequence number per run, type, timestamp, and structured data. Reconnection uses `Last-Event-ID` to resume committed events without duplication. The stream sends heartbeats for intermediary timeouts and propagates cancellation to active work where safe.

The later implementation will define storage schema, heartbeat interval, retention duration, and client retry policy. This ADR only fixes the semantic contract.

## Alternatives considered

- Stream provider events directly: reject. It leaks vendor behavior and cannot promise stable reconnection semantics.
- Keep an in-memory event buffer: reject. Restart and multi-process failures lose history.
- Use WebSockets first: defer. SSE matches one-way server progress with simpler browser and proxy behavior.

## Consequences

Streaming adds durable writes and ordering work, but browser recovery and audit records share one source of truth. The closest .NET comparison is persisting an ordered event log before writing an `IAsyncEnumerable` response, rather than relying on a live SignalR connection as the record. Event payloads must remain user-facing and never include hidden reasoning.

## Review trigger

Revisit if bidirectional low-latency interaction becomes a validated requirement, or if measured event volume requires a different durable delivery mechanism while preserving ordering and resume guarantees.
