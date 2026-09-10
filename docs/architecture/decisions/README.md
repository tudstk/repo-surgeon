# Architecture decisions

These records capture decisions that guide future implementation. They are not evidence that a feature already exists.

| ADR                                                   | Decision                                            | Applies from                 |
| ----------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| [0001](0001-modular-monolith-dependency-direction.md) | Modular monolith and dependency direction           | Milestone 1                  |
| [0002](0002-direct-sqlalchemy.md)                     | SQLAlchemy directly, not SQLModel                   | First persistence slice      |
| [0003](0003-provider-boundary.md)                     | Narrow provider protocol with optional thin adapter | First agent slice            |
| [0004](0004-mcp-placement-and-transport.md)           | MCP as a thin in-process adapter                    | Safe file tools              |
| [0005](0005-sse-persistence-and-reconnection.md)      | Persisted, sequenced application events             | First streamed run           |
| [0006](0006-repository-confinement-and-storage.md)    | Confined roots and app-managed clones               | Repository registration      |
| [0007](0007-privacy-retention-and-redaction.md)       | Explicit provider retention and redacted audit data | First provider or audit data |

The master build plan remains authoritative. Update an ADR through a new decision when evidence changes a foundational choice.
