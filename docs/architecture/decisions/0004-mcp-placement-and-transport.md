# ADR 0004: Expose MCP tools through thin application-backed handlers

**Status:** Accepted for safe file tools

## Context

MCP is useful for presenting constrained repository operations to the model, but it must not become a second business-logic path. Safe reading needs the same confinement, limits, typed errors, and audit behavior regardless of whether a future HTTP endpoint or MCP handler calls it.

## Decision

Place MCP in a dedicated `mcp` adapter module. MCP handlers validate typed inputs, call application services, map typed outputs and errors, and record the required audit event. They contain little business logic. Begin with an in-process transport and test tools with an in-process MCP client. Select an external transport only when an integration requires it.

FastMCP 2.x will be pinned exactly when MCP implementation begins, until a deliberate adoption of a stable 3.x line. This ADR does not introduce a running MCP server.

## Alternatives considered

- Put file operations directly in MCP handlers: reject. It duplicates authorization and risks divergent behavior.
- Make MCP the internal application API: reject. Application services must remain usable without a model protocol.
- Publish a remote MCP server now: defer. It enlarges the attack surface before a consumer requires it.

## Consequences

Tool contracts stay explicit: Pydantic input and output models, strict limits, typed errors, descriptions, and direct contract tests. This is similar to keeping an ASP.NET Core endpoint thin over an application service. A later transport change should preserve tool semantics instead of changing security policy.

## Review trigger

Revisit before exposing MCP beyond the application process or if a real client requires a transport whose authentication and tenancy model changes the threat boundary.
