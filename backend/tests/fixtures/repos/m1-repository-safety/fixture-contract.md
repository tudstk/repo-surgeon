# Milestone 1 repository safety fixture contract

This fixture is intentionally small and contains no live secrets, valid keys, or production data.
It models inputs that a user may register accidentally or an attacker may cause a tool to request.
The future implementation must decide after resolving the requested path against the registered canonical root and before returning file content.

## Files that must be permitted

| Fixture path | Scenario | Future assertion |
| --- | --- | --- |
| `README.md` | A user reads a normal UTF-8 root file. | It can be listed and read with a relative path and numbered lines. |
| `src/main.py` | A user inspects source code. | It can be listed and read without host-path disclosure. |
| `src/deep/nested.txt` | A safe nested child is requested. | It remains permitted after canonical containment checking. |
| `link-inside` | A symlink resolves to `src/main.py` inside the canonical root. | Permit it when the resolved target is an in-root regular file. |
| `docs/many-lines.txt` | A user asks for a range from a multi-line file. | Start/end-line selection and line-count clamping report truncation deterministically. |

## Files that must be denied before content is returned

| Fixture path | Scenario | Future assertion |
| --- | --- | --- |
| `.env` | A checked-in environment file contains a fake token. | Secret-policy matching denies content and does not echo it. |
| `config/credentials.json` | A credential-shaped filename contains inert JSON values. | Secret-policy matching denies content and does not echo it. |
| `id_rsa` | A key-shaped filename contains inert marker text. | Key-policy matching denies content and does not echo it. |
| `binary.dat` | A binary payload includes NUL bytes and all byte values. | Binary detection denies `read_file`; listing may expose only safe metadata. |
| `oversized.txt` | A text file exceeds the fixture's 64 KiB boundary. | The configured byte cap denies it before a response is made. |

## Requests that must always be denied

These paths are request corpus, not committed fixture files, because Git cannot safely track an embedded `.git` directory and because dangerous targets must remain outside this repository.

| Request | Scenario | Future assertion |
| --- | --- | --- |
| `../outside.txt` | Relative traversal attempts to leave the root. | Deny with the implementation's stable unsafe-path error and no bytes. |
| `src/../../outside.txt` | Normalized traversal attempts to leave the root. | Deny before filesystem content is returned. |
| `/etc/passwd` | Absolute host path attempts to bypass the root. | Deny before resolution against the host filesystem. |
| `.git/HEAD` | A request targets Git metadata. | Deny Git internals even if a repository contains them. |
| `.git/config` | A request targets Git configuration. | Deny Git internals even if a repository contains them. |
| `link-outside` | A symlink resolves to a target outside the canonical root. | Deny after symlink resolution, not lexical prefix checking. |

## Portable special-file case

The contract test creates a FIFO in a temporary directory on POSIX systems instead of committing one to Git.
A future file resolver must classify it as non-regular and deny it without opening it.
The test skips this setup where `os.mkfifo` is unavailable.

## Future Git-internal test

The fixture does not commit a `.git` child because Git treats that name specially.
A future implementation test must construct a real `.git` child beneath a temporary registered root, request a Git-internal path from it, and assert the stable unsafe-path error with no content returned.

## Reproducibility

`generate_fixtures.py` deterministically produces `binary.dat` (4,096 bytes) and `oversized.txt` (132,096 bytes).
The test suite verifies their exact size and selected content shape, so accidental fixture drift is visible before a security implementation relies on it.
