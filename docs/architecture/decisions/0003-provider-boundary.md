# ADR 0003: Keep model providers behind a narrow internal protocol

**Status:** Accepted for the first agent slice

## Context

Provider APIs, streaming formats, tool-call payloads, pricing, and retention controls change independently of Repo Surgeon's product rules. The product needs deterministic tests that do not require credentials or internet access, and it must not expose provider-specific events to its users.

## Decision

Start with one provider behind a small internal `ModelProvider` protocol. The protocol will accept validated application inputs and return structured, normalized results. Use the provider's supported Responses-style API when available. A direct SDK integration is preferred; a thin PydanticAI adapter is acceptable only if it keeps orchestration, authorization, budgets, and event normalization in Repo Surgeon code.

Set provider-side response storage explicitly once a provider is configured. The exact provider, model, SDK, and retention setting are later implementation choices.

## Alternatives considered

- Call a provider SDK from agent or API handlers: reject. It leaks transport and provider concerns into product policy and makes fakes difficult.
- Adopt a framework-owned graph or workflow engine: reject for now. It could obscure the bounded agent state machine.
- Support multiple providers immediately: defer. Contract tests for one path should be stable first.

## Consequences

Tests can use a deterministic fake provider, much like substituting a C# interface implementation in a test. The adapter boundary adds a small translation layer, but it prevents SDK events and defaults from becoming public contracts. Adding a provider later requires contract tests, explicit privacy settings, and normalized event compatibility.

## Review trigger

Revisit when a second provider has a validated product need, or when the chosen SDK cannot support required structured output, streaming, or explicit retention controls.
