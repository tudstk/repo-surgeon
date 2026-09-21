# ADR 0006: Confine repository access and use app-managed storage for clones

**Status:** Accepted for repository registration and safe reading

## Context

Repository content is untrusted input. Local paths may contain symlinks, secrets, devices, sockets, Git internals, or traversal attempts. The product also needs a predictable place for repositories cloned from a public URL without treating the user's checkout as application-owned.

## Decision

Register a local repository only after resolving its canonical root and persisting both the path and its filesystem device/inode identity. Every filesystem operation verifies that the current root still has the registered identity, then resolves relative paths and checks containment after symlink resolution. Reject a directory replacement at the same pathname, including an attempt to register the replacement as the existing capability. Legacy rows without an identity remain unavailable until explicit re-registration binds their current root. Reject absolute paths, traversal, escapes, disallowed Git internals, device files, sockets, unsafe or secret-matched paths, binary files where text is required, and inputs beyond configured size or result limits.

Public URL clones go into app-managed storage. The application must never apply a proposal to the connected local working tree. Exact ignore rules, storage layout, limit values, and cloning implementation are later decisions constrained by these guarantees.

## Alternatives considered

- Trust client-supplied paths after lexical normalization: reject. Normalization alone cannot prevent symlink escapes.
- Run all operations from the current process directory: reject. It has no durable repository identity or confinement anchor.
- Clone into arbitrary user-selected folders: reject. Ownership and cleanup become ambiguous.

## Consequences

Confinement is a deterministic application service shared by file, search, and Git adapters. This is closer to a capability rooted at one approved directory than to accepting a path string from a controller. It requires adversarial fixtures and negative tests before broad file capabilities are added.

## Review trigger

Revisit before allowing private clones, repository refresh, multiple tenants, or a new filesystem operation that needs an exception to the safety policy.
