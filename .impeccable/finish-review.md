# Workspace redesign finish review

Reviewed directly by the solo implementation agent on 2026-11-06, against the current source and a fresh production-build capture packet. No delegated review or model-provider call was used.

## Verdict

Ready for PR review. The three desktop panes, repository context, latest exchange, composer and saved-event evidence are coherent at 1440, 1280, 1200 and 1920 CSS-pixel widths. At 390px the conversation leads and modal drawers expose repository/session selection and events. Light and dark palettes retain readable hierarchy. Empty, loading, ready, busy, error, failed-run, callback-error and unavailable states use factual copy.

Live startup also exposed a missing temporary demo source: a typed 503 `repository_unavailable` now clears selected content while keeping already-authorized repository choices available. Authorization failures still clear all private choices, covered by a separate browser regression.

The source review found and corrected a delayed session restore overriding a newly created session, plus session creation incorrectly labelled as inspection. Both were reproduced in Playwright before correction. An ambiguous repository/session test locator was made exact, and the existing stale-create unit test now proves its POST actually started before switching repositories.

The prior mechanical detector had no findings. This continuation reused that result and performed direct source/rendered review instead of restarting discovery or the detector workflow. Retained investigation/citation CSS uses current semantic tokens; local-only components remain outside the authenticated workspace. API clients, backend authorization, CSRF and same-origin proxy contracts were preserved.

## Evidence

- Frontend: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (30 passed), `pnpm test:e2e` (18 passed), `pnpm build`.
- Backend: `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy src tests`, `uv run pytest` (194 passed, one PostgreSQL integration test skipped because no disposable test database was configured).
- Production fixture build: `REPO_SURGEON_API_ORIGIN=http://127.0.0.1:8010 pnpm build`, then `pnpm start --hostname 127.0.0.1 --port 3001`, alongside `node e2e/proxy-api-server.mjs`. All 18 browser tests passed against that production server.
- `node e2e/review-capture.mjs`: 26 captures, each with exact viewport and document-width validation. Manifest includes capture time, token values and contrast pairs. Minimum checked text-pair contrast: dark 6.61:1, light 5.16:1; checked control borders exceed 3:1.
- Playwright checks drawer focus wrapping, Escape and focus return, disabled duplicate sends, error retry, failed-but-persisted events and unavailable-route navigation. The 720x450 test verifies reflow geometry corresponding to 200% zoom; it does not drive browser chrome zoom.
- Captures are ignored under `.impeccable/review/`. Viewport tests attach desktop/phone/drawer screenshots to `frontend/test-results/`; CI publishes the `browser-review-evidence` artifact for 14 days.

## Limits

These browser journeys use synthetic identities and responses, not live GitHub OAuth or PostgreSQL. Existing database rows and ownership were preserved. Local startup registered a fresh synthetic demo through the existing API after the earlier temporary source disappeared. The user's actual desktop viewport and mobile software-keyboard behavior were not measured. Token contrast checks are not a comprehensive accessibility audit.

GitHub login does not import repositories. The deterministic provider lists files and returns a fixed completion message. Only the latest exchange is displayed. Proposals, test execution, approval, application, repository writes and a complete audit ledger remain unavailable. Fixed desktop dividers are intentional; resizing is not implemented in this slice. There are no shipping raster assets requiring provenance.

## Composer focus follow-up

A user-reported nested focus outline was reproduced in both palettes: the textarea had its own outline inside the focused composer border, visually separating the footer. Focus now uses one outline on the shared composer container while Inspect retains its own keyboard outline. Desktop and phone captures were visually reviewed. The updated frontend passed formatting, lint, types, 30 unit tests, 20 browser tests and the production build; the earlier 18-test production-fixture run above remains the recorded production journey.

## Account navigation follow-up

Replaced the workspace header's read-only badge and Profile tab with the safe GitHub avatar, username tooltip and icon-labelled Profile/Settings menu. Profile and Settings share that header; static public unavailable pages keep a generic account link. The new authenticated Settings page describes current appearance/provider defaults without claiming configuration support. Dark/light desktop/phone screenshots, menu keyboard/outside-dismissal behavior, navigation, missing-image fallback and signed-out Settings access were checked. No authentication or backend capability was added. Frontend formatting, lint, types, 31 unit tests, 23 browser tests and the production build passed.
