# ADR 0002: Use SQLAlchemy directly instead of SQLModel

**Status:** Accepted for the first persistence slice

## Context

The application will persist repositories and later sessions, proposals, approvals, and audit records in PostgreSQL. These concepts have different API, domain, and database concerns. Combining them into one model risks coupling HTTP validation and persistence layout to domain behavior.

## Decision

Use SQLAlchemy 2.x async directly for persistence and Alembic for migrations. Keep SQLAlchemy mappings separate from Pydantic request/response schemas and from domain value objects where that separation protects a real rule.

This is a choice for forthcoming persistence code. No database model is introduced by this ADR.

## Alternatives considered

- SQLModel: reject for the initial implementation. Its convenience comes from combining Pydantic and SQLAlchemy shapes, which is not a good fit for explicit, security-sensitive boundary models.
- Raw SQL only: reject. It would make ordinary mapping and transaction work more manual without making confinement or authorization safer.
- Another ORM: defer. SQLAlchemy has mature async support and fits the planned PostgreSQL and Alembic stack.

## Consequences

There will be more explicit mapping code, but ownership of validation is clearer. The closest .NET analogy is using EF Core entities separately from API DTOs rather than binding controllers directly to tracked entities. Transaction and migration behavior must be documented and tested as each data slice arrives.

## Review trigger

Revisit if direct SQLAlchemy prevents a concrete required workflow or if evidence shows the mapping layer has become repetitive without preserving a meaningful boundary.
