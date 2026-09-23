# Authentication foundation threat model

Milestone 4.5A records the boundaries that later identity slices must preserve.

| Threat | Foundation control and next negative test |
| --- | --- |
| Login CSRF or state swapping | Fixed callback, one-time state, PKCE S256, and browser binding. Wrong, replayed, expired, and cookie-mismatched state must fail before exchange. |
| Session fixation or theft | Fresh opaque server session after login, digest-only persistence, Secure/HttpOnly/SameSite cookie, idle and absolute expiry, and revocation. |
| Cross-site mutation | Exact trusted origin plus a per-session CSRF token on every unsafe method. Logout is POST and idempotent. |
| Open redirect | No caller-controlled return URL; callback always lands on the fixed internal route. |
| Token leakage | GitHub tokens and codes stay in FastAPI memory only, are redacted from logs, and never enter browser storage, URLs, or durable tables. |
| Local filesystem exposure | `public_authenticated` rejects local repository registration and every local repository read before path resolution. Startup also rejects public plus local access. |
| Cross-tenant access | Every repository and future aggregate lookup carries an immutable authenticated user ID; foreign and unknown IDs return the same 404. |
| Host/proxy confusion | Exact public origin and allowed hosts are validated at startup. Forwarded headers are trusted only from deployment-owned ingress. |

This milestone intentionally has no OAuth exchange, credentials, session table, or
public clone path. Those controls are acceptance criteria for 4.5B-4.5F, not claims
that the current checkout already authenticates users.
