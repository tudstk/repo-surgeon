---
version: 1
slug: "frontend-src-app-landing-page-tsx"
primary_target: "frontend/src/app/landing/page.tsx"
related_targets: ["frontend/src/app/landing/landing.module.css", "frontend/src/app/landing/inspection-mark.tsx", "frontend/src/app/landing/inspection-mark.module.css", "frontend/src/components/ui/circuit-field.tsx", "frontend/src/components/ui/circuit-field.module.css"]
---

# Repo Surgeon landing page

Mode: Persuade. Kind: software. Local product page, not a separately hosted Site.

Current user direction: much more technology-inspired and closely connected to the actual repository workspace, with a simple artistic layer. This supersedes the initial cyberpunk/wabi-sabi poster treatment. The user requested inspiration from the Impeccable and Taste Skill landing pages; both official pages were opened and inspected. Keep the charcoal ground, existing green and one coral accent. `/landing` remains the preview; the workspace remains at `/`.

THESIS: Inspect the repo. Keep control. Show what the current product actually does as soon as the visitor arrives.

OWN-WORLD: Single #101214 ground, existing #64d8c5 green, #f47b68 coral. Locally hosted IBM Plex Sans, with code/sequence values using the existing mono family. A globe built from gray code bands with restrained green syntax, a cursor-following review magnifier and a faint original circuit field carry the artistic layer. The user removed all ambient and pointer-triggered background pulses to keep the texture static. The sign-in page reuses the texture with a vignette and an opaque panel. No stock tech imagery, fake terminals, fictional operational data, glows or grain.

FIRST VIEWPORT: Shared header above a clear two-line product statement and working Open workspace action. On desktop, a globe of counter-scrolling code and its magnifier sit beside the copy. The actual workspace capture begins immediately below this opening, rather than after a separate full-height poster. Synthetic demo data is explicitly identified. At tablet widths the artwork drops out; on phones the product capture switches to the actual phone UI.

STORY: See the product and its current release label; inspect the real captured workspace; learn the repository/session/saved-context sequence; read the provider and unavailable-feature boundaries; enter the workspace. No pricing, testimonials or invented usage figures.

INTERACTION: The geometric background is static, including on pointer movement. The globe uses cached canvas strips instead of animated SVG text paths and a cloned SVG subtree. Both globe and lens draw the same curved source geometry with one bounded frame loop; input movement does not render React or reshape text. The simple handle remains fixed. Cursor tracking, keyboard arrows, pinning/Escape, illustrative helper edits, reduced motion and offscreen/hidden-tab pausing remain intact. No API or model requests are made.

IMPLEMENTATION: Code-led revision of the existing preview. Reuse good capture assets and their provenance, preserve identity/session behavior, adapt Taste's product-first and plain-copy guidance to this existing Next.js project. No new tool install, discovery tournament, delegated review or orchestration.

REVIEW: Direct solo rendered/source review at 1910/1440/1280/1024/768/390/320, including keyboard navigation, reduced motion, readable contrast and no document overflow. The shipped font license, source/capture provenance, design tokens and factual limitations travel with the page.
