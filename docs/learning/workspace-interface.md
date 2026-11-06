# Read-only workspace presentation

The interface separates repository context, the latest exchange and saved evidence.
Durable saving and successful execution are independent: a failed tool event can still be persisted.
Session creation and inspection also have separate pending labels; creating a session does not run a provider.
The composer explains the deterministic provider before submission so a saved fixed response is not mistaken for a tailored model answer.

## Read these files

1. `frontend/src/components/ui/shell.tsx` composes shared identity and navigation; `icons.tsx` defines the common SVG symbols.
2. `frontend/src/app/globals.css` owns semantic dark/light tokens and structural breakpoints.
3. `frontend/src/app/workspace.tsx` coordinates existing API calls and presents the selected session.

The API clients in `frontend/src/lib/` remain the authority for same-origin requests, no-store reads, CSRF and persisted event parsing.
Like an ASP.NET view model, the controller composes server state for display; it does not grant authorization.
Generation guards prevent a response from an earlier selection replacing the current repository or session.
Creating a session also advances the generation after success, so an older restore cannot select itself afterward.

## Interaction and safety

Desktop uses fixed 260-280px repository and 420px evidence panes, with a fluid conversation between plain noninteractive rules.
At 1100px and below, the side panes become native dialogs with Tab wrapping, Escape dismissal and focus restoration.
The account avatar opens a menu with native Profile/Settings links, arrow/Home/End navigation, Escape/Tab exit and outside dismissal. The shared avatar falls back to an initial if its safe GitHub image fails. Settings reuses the identity session guard and currently explains defaults without editable controls.
Selections use real buttons with `aria-pressed`; unavailable features use static explanations instead of disabled-looking navigation.
The light palette follows `prefers-color-scheme`; there is no theme toggle to persist or hydrate.

A request flows from the composer to the unchanged CSRF-protected turn API, then retrieves saved events and session detail.
Only current-generation responses update the display.
A typed 503 source-unavailable response clears selected content while preserving already-authorized repository choices; other failures still clear private workspace state. This lets a missing source recover through another assigned repository without weakening authorization errors.
No new repository import, write, sandbox, approval or backend capability is introduced.

## Verify and extend

From `frontend`, run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e`.
If the pinned browser is not already installed, use `pnpm exec playwright install chromium`.
Playwright starts an isolated frontend on 3001 and synthetic proxy on 8010.
Those browser fixtures do not prove live GitHub or PostgreSQL behavior.
Viewport tests attach desktop, phone and drawer screenshots to `test-results`; CI publishes them in the `browser-review-evidence` artifact for 14 days.
For a screenshot packet, run the test-only `node e2e/review-capture.mjs` against that isolated fixture pair; output is ignored under `.impeccable/review`.
Production Next.js proxy rewrites capture `REPO_SURGEON_API_ORIGIN` at build time, so a fixture production build must set it while building, not only while starting.

Questions to check understanding:

- Why can a failed event still say Persisted?
- Why does GitHub identity not imply repository import permission?
- Which guard prevents stale session responses replacing the current selection?
- Why do mobile dialogs need focus restoration as well as Escape dismissal?
- Why does evidence from a proxy fixture not prove database persistence?

As a small extension, add a keyboard-focused regression for switching between two saved sessions without weakening the existing generation guard.
The useful lesson from this slice is to describe actual capability before polishing its visual presentation.

## Landing preview

`frontend/src/app/landing/` is a public presentation surface, with its own scoped charcoal/green/coral palette and locally hosted OFL font. It makes no identity or workspace API request. The workspace CTA enters the existing authenticated `/` flow. Product images are actual isolated fixture captures, with provenance in `assets.json`; they are shipped presentation assets, distinct from ignored QA captures. The coral text layer is hidden from assistive technology, so the heading is announced once. After the user's direction change, locally hosted IBM Plex Sans and the real workspace lead the page; original SVG paper document geometry supplies the smaller artistic layer. The shared `components/ui/circuit-field.tsx` now adds static SVG texture to the hero and sign-in page, with one ambient native packet at a time. It now waits only 350-1000ms between packets. Mouse movement can add two short route-following packets; route points are cached once and current SVG transforms map the pointer to the nearest path. It chooses visible routes after responsive cropping, pauses offscreen or when the tab is hidden, respects reduced motion, and cleans up timers/animations on unmount. Sign-in places its existing content in an opaque bordered panel over a vignette. The brand returns to `/landing`, while Workspace still opens `/`. This is presentation state only; it changes no auth, ownership or persistence contract.
