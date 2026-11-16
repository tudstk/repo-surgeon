---
name: Repo Surgeon
description: A calm repository inspection workspace.
colors:
  canvas: "#101214"
  panel: "#15181c"
  raised: "#1b1f24"
  hover: "#242a30"
  border: "#343c45"
  control-border: "#65717e"
  text: "#eef1f4"
  muted: "#a8b0ba"
  accent: "#64d8c5"
  accent-ink: "#092c27"
  selected: "#19352f"
  success: "#83d9ad"
  warning: "#edc16a"
  danger: "#ff9ca6"
  danger-surface: "#302025"
  landing-signal: "#f47b68"
  light-canvas: "#ffffff"
  light-panel: "#f5f7f8"
  light-raised: "#ebeff2"
  light-hover: "#e2e8ec"
  light-border: "#c1cad2"
  light-control-border: "#80909d"
  light-text: "#1c252c"
  light-muted: "#52616d"
  light-accent: "#116a5b"
  light-accent-ink: "#ffffff"
  light-selected: "#e0f2ed"
  light-success: "#16653c"
  light-warning: "#795400"
  light-danger: "#a8273c"
  light-danger-surface: "#fff0f2"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  heading:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  label:
    fontSize: "12px"
    lineHeight: "20px"
  code:
    fontFamily: "'SFMono-Regular', Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.6
  landing-display:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "clamp(56px, 6.5vw, 92px)"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.04em"
rounded:
  control: "6px"
  badge: "4px"
  landing-action: "4px"
  identity-panel: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  landing-action:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.landing-action}"
    padding: "12px 20px"
---

# Design System: Repo Surgeon

## Overview

**Creative North Star: "Calm repository inspection"**

DeepSource-informed neutral charcoal, quiet rules and restrained teal create a compact developer workspace for sustained inspection. System sans typography carries the interface; monospace is reserved for code, paths and event identifiers. The light palette follows the operating system.

**Key Characteristics:**

- Three connected work areas with aligned headings.
- Flat tonal surfaces, readable rows and an original SVG identity.
- Explicit selection, saving and outcome states.

## Colors

The frontmatter records the actual semantic tokens from `frontend/src/app/globals.css`; `light-` entries replace their dark counterparts under `prefers-color-scheme: light`.
Teal identifies primary actions, focus and selected rows. Neutral canvas, panel and raised surfaces establish hierarchy. Muted text carries supporting explanations. Success, warning and danger retain distinct meanings and always accompany words or icons.
Control borders use their dedicated higher-contrast token; subtle dividers use the ordinary border token.
The `/landing` variant stays on the dark canvas in every OS theme. It combines the existing green with a narrow coral type slice and a clean paper document outline; neutral white/muted copy provides the remaining hierarchy. The hero alone carries a low-opacity geometric circuit field; the rest of the landing page stays quiet. The sign-in screen reuses that field with a soft radial vignette and its existing OS-driven palette.

## Typography

Body text uses the platform sans stack at the body role. Page headings use the heading role; pane headings are 14px/20px semibold. Supporting labels are 12px, repository and session rows remain body-sized. The phone composer uses 16px input text to avoid browser focus zoom.
Following user feedback, the landing page uses locally hosted variable IBM Plex Sans, with 500-weight headings and 400-weight body copy. The two-line display tops out at 92px, scales to 72px on tablets and uses clamp(34px, 10.8vw, 60px) on phones. This replaces the earlier condensed poster typography. The application retains its established readable interface typography.
Code uses the code role. Conversation copy is constrained to 70ch and explanatory copy to 65ch where space permits.

## Layout

The workspace opens with a single repository toolbar. The compact brand link and active repository name lead, with the GitHub username and avatar at the right. The Code tab pairs its snapshot revision, read-only status and Sync controls in the upper-right corner. The controls wrap beneath the tabs as the pane narrows. Desktop uses a 280px repositories and sessions pane, a fluid center, and a resizable Code and Activity pane. From 1101px through 1280px the left pane is 260px.
At 1100px and below only the conversation is shown in the main grid; labelled buttons open repository/session and event drawers. At 600px and below, spacing tightens, context wraps, and primary controls have a 44px minimum height. The shell uses dynamic viewport height. Conversation and event content scroll within their own areas; the composer stays in view.
Spacing mostly follows 8/12/16/20/24/32px steps. Login content is capped at 440px; account content at 720px. Keep all grid/flex children shrinkable and wrap long user data.

The public `/landing` preview is capped at 1280px, with 64px desktop gutters, 40px intermediate gutters and 20px phone gutters. A concise split opening leads directly into the real workspace capture so the product starts in the first viewport. The decorative artwork disappears at 800px; explanatory columns stack there. At 600px the phone capture replaces the desktop capture and the actual three-step workflow becomes a vertical ordered list. Current-release disclosures precede a compact closing action. Sections grow naturally for text reflow.

## Elevation & Depth

Flat tonal layering and single-pixel dividers establish depth. No card shadows or decorative glow are used. Modal drawers use a 60% black backdrop and a sticky close toolbar.

## Shapes

Controls and messages use the control radius; small badges use the badge radius. The sign-in panel uses the identity-panel radius; it is an opaque panel surface with one ordinary border and 40px padding, reduced to 24px on phones. The profile avatar is circular. Icons are original 24-unit SVG paths with consistent rounded strokes; the GitHub mark identifies the login provider.

## Components

- **Header and account menu:** The workspace brand icon returns to `/landing`. Profile and Settings use the shared header with a Workspace return link. The landing page's own brand links use `#top`. Hover or focus on the circular GitHub avatar reveals the username. Click opens Profile and Settings links with icons. The menu supports arrows, Home/End, Escape, Tab exit and outside dismissal. The trigger is 44px with a 32px image and an initial fallback.
- **Buttons:** Teal primary and outlined neutral secondary actions; stable hover treatments, explicit disabled states, and 2px accent focus outlines with 3px offset. Principal phone actions are at least 44px high.
- **Selection rows:** Native buttons use `aria-pressed`, teal text and a selected surface. Repository rows show the name, with the snapshot revision in the Code tab. Session titles stay on one line and use an ellipsis when they overflow. The full title is available on hover and as the button's accessible name.
- **Composer:** Textarea focus outlines the shared input container, including its footer, without a nested textarea ring. Inspect keeps its own keyboard focus outline. A visible demo-provider disclosure precedes the bordered textarea. Inspect is disabled without a session, during submission and for instructions shorter than three trimmed characters. Input is capped at 8000 characters.
- **Events:** Ordered identifiers, tool or event names, UTC time, and separate outcome and persistence labels. Failure uses danger text and a danger surface, including when the event was saved successfully.
- **Drawers:** Native modal dialogs provide protected focus, Tab wrapping, Escape dismissal and trigger-focus restoration. Returning to desktop closes the drawer. They reuse pane content rather than displaying duplicate controls.
- **Identity and unavailable pages:** Shared brand and typography, factual scope, specific retry paths, and real return links. No imaginary repository or sandbox context.

The landing headline keeps its narrow, static coral slice and original paper document mark. The shared CircuitField is limited to the hero and sign-in screen: twelve original geometric routes use 1px non-scaling strokes at 0.13 opacity. Two introductory green or coral packets each traverse a visible route over 950-1450ms, with 350-1000ms of quiet between them. Three short native SVG dash layers create a tapered head and tail without glow. Mouse movement emits 350ms pulses along the nearest route, throttled to one emission per 180ms and two concurrent pointer packets. Fixed route samples are cached once; each event uses the current SVG coordinate transform. The paper icon is an unframed outline with a fold and text lines, in a 240px drawing viewport. The texture renders statically before hydration; reduced motion and unsupported APIs retain it. Offscreen or hidden pages cancel motion, and unmount clears timers and animations. The sign-in variant adds a radial vignette behind an opaque bordered panel. The decorative SVG is hidden from assistive technology and never intercepts content controls. No animation dependency, canvas, WebGL, external request or scroll-linked effect is used. Native disclosures and the actual repository/session/restore sequence remain unchanged.

The repository discovery dialog opens from the workspace context bar on desktop and mobile. A blurred backdrop separates the workspace from the opaque dialog. Initial focus goes to the search field and Escape returns it to the trigger. Public suggestions show the GitHub owner avatar and the full owner/repository name, with an initial as the fallback. Search status stays in the results region. Selecting a result imports a public source snapshot and selects it in the workspace. While importing, controls are disabled and a live status names the repository; failures remain in the dialog with a retry path. The dialog explains that imports are read-only and public-only.

Transitions use 160ms ease-out for color and borders. Reduced-motion preference disables transitions and animations. There is no theme switch; both palettes follow the operating system preference without client state.

## Do's and Don'ts

- Do use semantic tokens across both palettes.
- Do pair outcome colors with readable status text.
- Do keep visible keyboard focus and usable phone touch targets.
- Do wrap repository names and source paths within their panes.
- Don't imply resizing with decorative handles.
- Don't add inert tabs or fictional telemetry.
- Don't equate persistence with successful execution.
- Don't hide repository context to fit the desktop header.

Repository summaries use compact 12px metadata, local language logos and source-byte percentages. Scan limitations remain in the quiet footer rather than a prominent status badge. The repository picker supports owner prefixes and partial names, shows specific import failures, and closes on Escape even when the search input contains text.

Repositories and Sessions have independent chevron disclosures with current counts. Their add actions remain available when collapsed. Desktop repository creation lives beside the Repositories heading; mobile retains the context-bar shortcut and the drawer action. Expanding and collapsing preserves selection. New sessions and imports expand their corresponding list.

Repository rows include their three-dot action control inside the shared selection background. The Remove menu item uses a smaller 14px icon and opens a confirmation naming the repository and its associated sessions. Cancel receives initial focus; Cancel and Escape return focus to the menu trigger without sending a mutation. Failed removal stays in the dialog for retry. The menu supports keyboard opening, Escape dismissal and focus return, with Remove as its current action. Removal updates counts and clears a removed active selection; an inline Undo keeps this list operation reversible. Snapshots and saved sessions are retained.

The removal notice uses a gray surface and a small top-right dismiss action. Dismissing it returns keyboard focus to the repository heading and leaves repository visibility unchanged.

Session rows share the repository actions styling. Rename opens a prefilled name field. Remove names the session and focuses Cancel by default. Confirming removal updates the session count and selects a remaining session when needed.

The right workspace pane starts at 40% of the desktop viewport and can be resized from 20% to 50% with its divider. A narrow pane switches between the tree and preview to keep both usable. **Code** opens first and places the expandable file tree beside the scrollable, numbered preview. The selected repository-relative path sits above the code. A text-style **View more** action sits at the end of the loaded code. It appends up to 500 lines, preserves the scroll position, and reappears at the new end. Switching to **Activity** preserves the selected file. On mobile, **Code & activity** opens a drawer with a full-width tree or preview and a **Files** action that returns focus to the selected file.

The selected GitHub snapshot shows its remote status alongside its revision. **Up to date** uses the green state color. **Behind GitHub** uses amber and reveals **Sync**. A separate check action refreshes the status. Sync updates the commit in the existing row and preserves the selected session.
