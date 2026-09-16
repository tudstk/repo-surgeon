# Safe repository search

Milestone 3 adds `search_code`, a typed read-only MCP tool over a registered repository. Literal search is the default. Regex search is explicit and uses ripgrep's parser. Neither mode accepts a command string, shell option, host path, or repository-selected executable.

## Fixed limits

| Bound | Default | Hard limit | Result when reached |
| --- | ---: | ---: | --- |
| Search duration | 3,000 ms | 5,000 ms | `search_timed_out`; the child is killed and reaped |
| Matches | 50 | 200 | Successful result with `matches` truncation |
| Context, each side | 2 lines | 10 lines | Successful result with `context` truncation if bytes require removal |
| Search result | 64 KiB | 128 KiB | Context and then matches are removed at model boundaries |
| Candidate files | n/a | 1,000 | `search_output_limit` |
| File size | n/a | 64 KiB | File is skipped before content search |

The adapter first asks ripgrep for files visible under normal ignore rules, with parent-repository ignore files disabled so the registered root owns its policy. It then applies the M1 confinement and secret-name policy and validates bounded UTF-8 content before passing safe relative filenames to a second fixed argv. The search subprocess uses `shell=False`, `--` before the query and filenames, and `--fixed-strings` only for literal mode. Search results are re-read through the root-anchored descriptor boundary before they are returned, which preserves exact one-based file and line citations and rejects a file that changed during inspection.

Empty results are successful. Malformed regex, unsafe path or glob, timeout, subprocess failure, process-output overflow, missing repository, and returned-byte exhaustion use stable typed errors without raw stderr or host paths. Binary and invalid UTF-8 files are counted as skipped but never returned. `.git`, secret-like paths, absolute paths, traversal, symlink escapes, devices, and sockets remain unavailable.

`run_turn` injects the active repository ID after validating provider arguments. Its repeat key includes normalized effective defaults, clamps, path, glob, mode, and query. Activity events expose a bounded search summary, duration, hit count, truncation, error code, and citations derived from returned matches. They do not expose hidden reasoning, stderr, or arbitrary repository instructions.

## Repository intelligence catalog

`repository_intelligence.py` declares version 1 of two fixed catalogs. Language detection recognizes Python, TypeScript/JavaScript, C#, Go, Rust, and Java extensions, with known manifests as bounded tie-breakers. A winner needs a documented score margin; ties return low-confidence `None` instead of a guess. Size and approximate lines count at most 200 safe visible files and mark the scan partial when file, line, binary, or size bounds prevent completeness. Generated, vendored, dependency, build, and coverage directories are excluded.

Test detection reads only known manifests as bounded UTF-8 data. It maps evidence to fixed commands for pytest, Vitest, Jest, `dotnet test`, `go test`, and `cargo test`. Multiple frameworks are ambiguous. Unknown custom scripts are unsupported and are never executed or copied into a command.
