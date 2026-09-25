# Authentication threat model

Milestones 4.5A-4.5C establish and exercise the identity foundation. Repository
tenant authorization remains a later slice.

| Threat | Enforced control and test coverage |
| --- | --- |
| Login CSRF or state swapping | Fixed callback, one-time state, PKCE S256, and HttpOnly browser binding. Wrong, replayed, expired, and cookie-mismatched state fail before provider exchange. |
| Session fixation or theft | Successful OAuth login creates a fresh opaque session and revokes a presented session. Only digests persist. Secure public cookies are HttpOnly, host-prefixed, `SameSite=Lax`, and browser-session scoped. |
| Cross-site mutation | Logout is POST, requires an exact trusted Origin and a matching per-session CSRF token, clears its cookie, and safely permits an already-cleared retry. |
| Open redirect | No caller-controlled return URL exists. Successful callbacks always use the fixed internal `/auth/callback` route; safe fixed error enums return to login. |
| Token leakage | The HTTP adapter exchanges a code then makes one authenticated `/user` request. Tokens, codes, state, PKCE material, session values, and CSRF values do not enter durable identity data, redirects, or problem responses. |
| Local filesystem exposure | `public_authenticated` rejects local repository registration and every local repository read before path resolution. Startup also rejects public plus local access. |
| Cross-tenant access | Every repository and future aggregate lookup carries an immutable authenticated user ID; foreign and unknown IDs return the same 404. |
| Host/proxy confusion | Exact public origin and allowed hosts are validated at startup. Forwarded headers are trusted only from deployment-owned ingress. |

This milestone has no GitHub OAuth App configuration, live provider call, requested
scope, public clone path, private repository access, or repository authorization
retrofit. Tests use a deterministic in-process HTTP provider.
