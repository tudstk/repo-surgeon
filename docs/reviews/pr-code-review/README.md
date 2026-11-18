# PR code review evidence

Captured by the package-defined Playwright suite on 2026-11-18 using isolated synthetic API responses, at 1440x900 and 390x900. No private repository source, account data, credentials or live model output appears in these images. The fixtures send a genuinely chunked response through the Next.js same-origin rewrite. Both captures use dark mode and reduced motion.

- `desktop.png`: selected PR beside its saved, explicitly simulated Markdown response and copyable code.
- `mobile.png`: the tools drawer closes to show the response in the conversation.

Verification: 66 browser tests, 40 frontend unit tests, frontend format/lint/typing and production build passed. Backend format/lint/typing and 229 tests passed; one optional disposable-PostgreSQL test was skipped in the ordinary run and then passed separately against a newly created disposable database. One MCP search test failed during a concurrent resource-heavy run and passed in isolation and the subsequent complete backend run. No inference calls were used for tests. A separate live GitHub App/PostgreSQL simulation smoke completed with 34 visible files, 18 mapped source files and six excerpts, preserving the existing repository snapshot.

The code-context map is deterministic retrieval, not proof of whole-repository analysis. Simulation does not assess PR quality. Real OpenRouter quality and paid usage remain for manual evaluation.
