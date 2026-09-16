# 0009: Fixed-argument repository search

Repo Surgeon uses a killable ripgrep subprocess behind a typed application contract for exact search. The adapter constructs argv values, never a shell string. It applies independent time, match, context, file-count, process-output, and returned-byte bounds. Literal mode adds `--fixed-strings`; regex mode is opt-in and malformed patterns return a stable error.

Candidate discovery respects ignore files. Every candidate must also pass the existing repository confinement, visibility, regular-file, size, binary, and UTF-8 checks before ripgrep can search its content. Returned matches are verified through the confined descriptor reader before they become provider data or citations. This defense-in-depth keeps the registered canonical root and M1 policy authoritative across subprocess output and filesystem races.

A subprocess is preferred to an in-process regex engine because ripgrep provides mature exact matching and can be killed and reaped at the search deadline. The tradeoff is a second local process boundary and a bounded candidate-discovery pass. Raw stderr, host paths, and repository-selected commands never cross the tool contract.

Repository intelligence remains a separate deterministic detector. Versioned extension, manifest, ignored-directory, and test-command catalogs make its claims reviewable. It reports ambiguity or partial scans instead of executing a discovered command or guessing beyond fixed evidence.

This decision does not authorize Git history, embeddings, repository writes, provider integration, test execution, or sandbox commands.
