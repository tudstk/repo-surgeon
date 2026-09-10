# Safe file MCP tools

Milestone 1 exposes application-backed, in-process contracts for two read-only tools against a registered repository's persisted canonical root. No tool mutates the repository, starts a shell, or accepts a host path outside that capability.

- `list_files` accepts a relative directory, optional glob, and a result count clamped to 200. It performs a fixed walk and returns normalized relative paths, regular-file metadata, and truncation state.
- `read_file` accepts a relative path and one-based line range. It rejects files over 64 KiB and returns at most 200 numbered UTF-8 lines, a SHA-256 content hash, and truncation state.

Both tools resolve symlinks before containment checking. They deny absolute or traversal paths, outside targets, `.git` internals, secret-like names, non-regular files, binary content, and oversized content. A symlink is readable only when its resolved target is a regular file inside the canonical root.

Every public input and output is a strict Pydantic model. Results expose only relative paths and content-free audit summaries. FastMCP `2.14.6` is pinned for the adapter boundary, but this branch does not start an external MCP transport.
