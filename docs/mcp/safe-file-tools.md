# Safe file MCP tools

Milestone 2 exposes application-backed, in-process contracts for two read-only tools against a registered repository's persisted canonical root. No tool mutates the repository, starts a shell, or accepts a host path outside that capability.

- `list_files` accepts a relative directory, optional glob, and a result count clamped to 200. It performs a fixed walk and returns normalized relative paths, regular-file metadata, and truncation state.
- `read_file` accepts a relative path and one-based line range. It rejects files over 64 KiB and returns at most 200 numbered UTF-8 lines, a SHA-256 content hash, and truncation state.

Both tools resolve symlinks before containment checking. They deny absolute or traversal paths, outside targets, `.git` internals, secret-like names, non-regular files, binary content, and oversized content. A symlink is readable only when its resolved target is a regular file inside the canonical root.

Every public input and output is a strict Pydantic model. Results expose only relative paths and content-free audit summaries. FastMCP `2.14.6` is pinned for the adapter boundary, but this branch does not start an external MCP transport.

The adapter accepts an optional exact serialized-byte budget and truncates successful results or returns a bounded error envelope before exceeding it. Repository construction and synchronous inspection use one process-wide worker and slot, so cancellation does not accumulate queued filesystem work. The agent loop applies its own model-call, tool-call, repeat, duration, and total returned-byte limits and passes the fixed untrusted-data policy on every provider request. See [ADR 0008](../architecture/decisions/0008-bounded-agent-turn.md) for the agent boundary.
