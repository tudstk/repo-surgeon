# ADR 0001: Use a modular monolith with directed dependencies

**Status:** Accepted for Milestone 1 planning

## Context

Repo Surgeon needs strong boundaries around domain rules, untrusted repository access, persistence, model providers, MCP, and sandbox execution. It is still one product and one deployable application. Splitting it into networked services now would add operational failure modes before there is evidence that independent deployment is useful.

## Decision

Build a modular monolith. `domain` holds business concepts and rules. `application` holds use cases and ports and depends on `domain`. Infrastructure adapters implement those ports. `api`, `agent`, `mcp`, and `sandbox` call application services and must not make domain decisions independently.

The direction is `domain <- application <- infrastructure/api/agent/mcp/sandbox`. A sandbox runner may be a separate process because it crosses a trust boundary, but it remains part of this repository and uses an application-owned contract.

This is a structural direction for future code, not a claim that these packages or adapters already exist.

## Alternatives considered

- Microservices: defer. They would add deployment, authentication, versioning, and distributed tracing concerns without a demonstrated scaling need.
- Framework-first application design: reject. Letting FastAPI, an ORM, or an agent framework own core rules makes authorization harder to test independently.
- No module boundaries: reject. Repository access and provider behavior need explicit seams even in one process.

## Consequences

Use cases can be tested without HTTP, database, provider, or Docker dependencies. This resembles keeping ASP.NET Core controllers and EF Core details outside a C# domain/application layer. Boundary violations should be visible in imports and tests, not hidden in conventions alone.

Some interfaces will be introduced only when a real external concern needs substitution. Avoid abstractions with one trivial caller.

## Review trigger

Revisit when independent scaling, deployment, or trust isolation has measured evidence that a process boundary beyond the sandbox would reduce risk more than it adds operational complexity.
