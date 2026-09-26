# ADR 0010: FastAPI-owned GitHub identity and tenant boundary

## Context

Repo Surgeon is moving from a loopback-only local tool toward a public product. The
existing repository workflow is intentionally read-only, but it has no authenticated
principal and its local filesystem capability must never be exposed by a public
deployment. Later milestones need a stable owner on repositories and every future
proposal, run, and audit aggregate.

## Decision

FastAPI owns the GitHub OAuth authorization-code flow and the application session.
The browser receives only a server-set opaque session cookie; GitHub access
tokens, authorization codes, PKCE verifiers, and session values are never sent to
Next.js or stored in browser storage. The identity flow uses a fixed internal
callback, PKCE S256, one-time state, and a short-lived HttpOnly browser-binding
cookie. Unsafe methods require an exact trusted origin and CSRF token.

The first public identity flow requests no GitHub scopes and stores only the stable
GitHub user identity and safe profile snapshot. One user is one tenant for the first
public release. Repository ownership and all later aggregate ownership will be
explicitly scoped to that user; organizations and sharing are out of scope.

Configuration has two explicit modes: `local_trusted` keeps loopback-only local
repository access for development, while `public_authenticated` fails closed unless
OAuth/session settings are complete and local filesystem access is disabled. The
public callback is derived from one exact public origin and cannot be caller chosen.

Milestones 4.5A-4.5C establish these contracts, their persistence foundation, and
the identity-only OAuth exchange. The current slice does not configure a GitHub
OAuth App, request scopes, clone repositories, or add write capabilities.

## Alternatives considered

- NextAuth/Auth.js as a second session authority: rejected because split session
  ownership makes CSRF, token handling, and authorization harder to audit.
- Browser-held JWTs: rejected because revocation and token exposure are worse than a
  short-lived opaque server session for this product.
- Nullable repository ownership or a public bypass: rejected because either option
  makes cross-tenant authorization easy to miss. The migration will use a reserved
  local-development principal instead.

## Consequences

Local development remains usable with the existing loopback trust boundary. Public
mode can truthfully expose only read-only evidence until authenticated repository
access lands. The settings validator, persistence
contracts, OAuth adapter, and HTTP repository boundary are intentionally testable
without real credentials or network.

## Review trigger

Revisit when later milestones add authenticated repository access, private scopes, or
public ingress. Any proposal to retain GitHub tokens or enable public cloning requires
a new security review and ADR.
