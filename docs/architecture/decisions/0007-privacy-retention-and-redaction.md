# ADR 0007: Make provider retention explicit and persist only redacted audit data

**Status:** Accepted as a privacy baseline

## Context

Repository contents, prompts, provider responses, tool arguments, errors, and audit events may contain secrets or sensitive code. Provider defaults and log defaults are not a privacy policy. Auditability is required, but it must not become a second unbounded copy of sensitive material.

## Decision

Before the first real provider call, configure provider-side response retention explicitly and document the selected setting. Persist audit data needed to reconstruct actions: correlation identifiers, actor, action, target, validated argument summaries, result summaries, duration, status, and transition metadata. Redact secrets before persistence and before display. Do not persist hidden reasoning.

The specific provider setting, audit retention period, access-control model, and deletion workflow require implementation-time evidence and must be documented when chosen. This ADR establishes the constraints, not those unset values.

## Alternatives considered

- Rely on provider and logging defaults: reject. Defaults can change and are not an auditable choice.
- Store all raw payloads for debugging: reject. It expands privacy exposure and can retain secrets.
- Avoid audit persistence: reject. It prevents accountability for agent and approval actions.

## Consequences

Redaction becomes a shared, tested boundary used by logs, events, errors, and audit records. Think of it as structured logging with a mandatory data-classification filter before a C# logger sink, rather than a best-effort cleanup in the UI. Debugging may require intentionally captured, access-controlled test fixtures instead of production payloads.

## Review trigger

Revisit before enabling a real provider, changing provider retention, adding new audit payload categories, introducing multi-user access, or defining a production retention/deletion policy.
