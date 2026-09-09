# Glossary

This glossary covers concepts implemented in M0. MCP, model providers, repository confinement, sandboxing, proposals, and approvals are roadmap-only.

| Term | Meaning here | C#/.NET bridge |
| --- | --- | --- |
| ASGI | Interface through which Uvicorn invokes FastAPI. | Similar in role to an HTTP hosting pipeline, but it is a Python specification. |
| FastAPI | Framework declaring routes and typed HTTP responses. | Similar in purpose to Minimal APIs or controllers. |
| Uvicorn | ASGI server started with `uv run uvicorn repo_surgeon.main:app`. | Comparable to Kestrel as a development host. |
| Pydantic model | Validates and serializes typed data; `HealthResponse` limits status values. | Comparable to a validated DTO or record. |
| Pydantic Settings | Validated configuration from `REPO_SURGEON_` variables and `.env`. | Similar in purpose to typed options binding. |
| Type hints | Annotations checked by tools and used by libraries. | Similar to C# declarations, but Python depends on tools such as mypy. |
| mypy strict | Backend static-analysis configuration. | Similar to strict compiler diagnostics and analyzers. |
| uv and uv.lock | Python dependency installer, runner, and locked graph. | Comparable to SDK tooling plus a committed package lock. |
| Next.js App Router | File-convention React application framework. | Comparable in role to a routed web UI layer. |
| Strict TypeScript | Compile-time frontend checking with no emitted JavaScript. | Similar to C# checks, but types are erased for browser execution. |
| Docker Compose | Local PostgreSQL service, volume, port, and health-check definition. | A repeatable local dependency environment. |
| Quality gate | Required automated CI verification. | A pull-request validation pipeline. |

ASGI supports asynchronous handlers, but the M0 health handlers are synchronous because they do no I/O. Python `async` work becomes relevant when later milestones add I/O-bound services.
