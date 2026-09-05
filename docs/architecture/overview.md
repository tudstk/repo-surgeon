# Architecture overview

Repo Surgeon is planned as a local-first modular monolith with an explicit trust boundary around repository access, model integration, and isolated test execution.

The backend will keep domain rules independent from transport, persistence, provider, MCP, and sandbox adapters.

The intended dependency direction is `domain <- application <- infrastructure/api/agent/mcp/sandbox`.

Milestone 0 establishes conventions only and does not yet implement application architecture or make Architecture Decision Records.
