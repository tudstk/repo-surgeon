# ADR 0012: Import bounded public GitHub source snapshots

**Status:** Accepted for the public read-only import feature

## Decision

Implement the public-first repository addition request as a pinned source snapshot. It extends ADR 0006 confinement without adding Git credentials, subprocesses, hooks, submodule fetching or write capabilities. Private GitHub authorization remains deferred by explicit product direction.

The authenticated endpoint accepts only an owner/repository identifier. It verifies public visibility using a credential-free fixed GitHub API endpoint, resolves the default branch's current commit and downloads from a fixed codeload endpoint at that SHA. Redirects are disabled. Public-mode mutations retain the existing exact-Origin and per-session CSRF boundary. Search projects only public metadata and constructs owner avatars from validated numeric GitHub owner identifiers.

Storage is scoped by authenticated user UUID, GitHub numeric repository ID and commit SHA. Extraction validates paths, types, sizes and case-insensitive name collisions, writes into a private staging directory and atomically publishes under a filesystem lock. Registered roots retain device/inode identity. Duplicate registration uses the existing database uniqueness boundary. Repeated imports of the same revision preserve session references; new revisions become separate snapshots with visible short commit labels.

Downloaded archives are capped at 25 MiB, expanded source at 100 MiB and entries at 10,000. Path depth and length are bounded. A process admits two imports at once, including publication and cleanup. Queue/network time is limited to 60 seconds; cancellation waits for bounded filesystem work before freeing capacity. The existing bounded read and exact-search contracts remain the only agent-visible path to imported content. Repository code and detected commands are never executed during import.

## Consequences

The database migration is additive. Storage must persist alongside the database and be shared between workers. Publication followed by a database failure can leave an unregistered snapshot; retries reuse it. There is no automatic cleanup of registered directories. Tenant quotas, retention, automatic refresh, deletion, private authorization and full Git history need explicit follow-up work. Per-import size limits do not provide a cumulative disk quota.

This initial importer rejects symlink-containing repositories. Submodule sources are absent and LFS inclusion depends on upstream archive settings. Product copy calls the result a snapshot, not a clone or a complete repository history. No change to identity-only OAuth or provider-token retention is needed.

## References

- [GitHub source archive behavior](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)
- [GitHub commit listing and default branch behavior](https://docs.github.com/en/rest/commits/commits)
- `backend/tests/test_github_import.py` covers HTTP authorization, ownership, retry, usable summaries and hostile archives without external network access.

## Workspace visibility

An owner-scoped, CSRF-protected visibility mutation hides a registration from the workspace list without deleting its snapshot or session history. The database visibility flag defaults to visible for existing registrations. Undo restores visibility; reimporting the identical public commit restores the existing registration after its filesystem identity is verified. This is list management, not disk reclamation or GitHub deletion.

## Recover a stale device binding

A filesystem remount can change the device number of an existing snapshot directory. The owner can request recovery through a CSRF-protected mutation. The importer fetches the pinned public commit within the existing limits and compares the managed snapshot tree with the fresh archive without following links. Recovery requires the original canonical path, root inode and matching file contents. A conditional update changes only the saved device number, preserving sessions and the full device/inode check for later reads.

## Manual synchronization

The workspace status compares the registered SHA against the selected repository's default branch tip. It verifies public visibility and the original numeric GitHub ID encoded in the managed storage path before trusting that tip. The status request downloads metadata only. The owner-scoped, CSRF-protected Sync request resolves the tip again and reuses the bounded import path to register a distinct revision when needed. Source snapshots and sessions retain their existing IDs and bindings.
