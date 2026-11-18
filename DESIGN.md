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

DeepSource-informed neutral charcoal, quiet rules and restrained teal create a compact developer workspace for sustained inspection. System sans typography carries the interface; monospace is reserved for code, paths and event identifiers. By default, the interface follows the operating system’s appearance.

**Key Characteristics:**

- Three connected work areas with aligned headings.
- Flat tonal surfaces, readable rows and an original SVG identity.
- Explicit selection, saving and outcome states.

## Colors

The frontmatter records the actual semantic tokens from `frontend/src/app/globals.css`; `light-` entries replace their dark counterparts when the light theme is active.
The chosen accent identifies primary actions, focus and selected rows. Green is the default. Neutral canvas, panel and raised surfaces establish hierarchy. Muted text carries supporting explanations. Success, warning and danger retain distinct meanings and always accompany words or icons.
Control borders use their dedicated higher-contrast token; subtle dividers use the ordinary border token.
The `/landing` variant stays on the dark canvas in every OS theme. It combines the existing green with a narrow coral type slice and a green globe formed from curved, counter-scrolling code bands; neutral white/muted copy provides the remaining hierarchy. The hero alone carries a low-opacity geometric circuit field; the rest of the landing page stays quiet. The sign-in screen reuses that field with a soft radial vignette and the current application palette.

## Typography

Body text uses the platform sans stack at the body role. Page headings use the heading role; pane headings are 14px/20px semibold. Supporting labels are 12px, repository and session rows remain body-sized. The phone composer uses 16px input text to avoid browser focus zoom.
Following user feedback, the landing page uses locally hosted variable IBM Plex Sans, with 500-weight headings and 400-weight body copy. The two-line display tops out at 92px, scales to 72px on tablets and uses clamp(34px, 10.8vw, 60px) on phones. This replaces the earlier condensed poster typography. The application retains its established readable interface typography.
Code uses the code role. Conversation copy is constrained to 70ch and explanatory copy to 65ch where space permits.

## Layout

The workspace opens with a single repository toolbar. The compact brand link and active repository name lead, with the GitHub username and avatar at the right. The Code tab pairs its snapshot revision, read-only status and Sync controls in the upper-right corner. The controls wrap beneath the tabs as the pane narrows. Desktop uses a 280px repositories and sessions pane, a fluid center, and a resizable Code and Activity pane. From 1101px through 1280px the left pane is 260px. The three pane headers share one row so their dividers stay aligned when the Code toolbar wraps.
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
- **Repository summary:** File count and approximate lines of code lead, with test detection above the language breakdown. The breakdown shows full-color language icons, numeric percentages, and teal bars scaled to source-byte share. A native Scan details disclosure holds confidence, scan date, detected command, and coverage limits.
- **Composer:** Textarea focus outlines the shared input container, including its footer, without a nested textarea ring. Inspect keeps its own keyboard focus outline. A visible demo-provider disclosure precedes the bordered textarea. Inspect is disabled without a session, during submission and for instructions shorter than three trimmed characters. Input is capped at 8000 characters.
- **Events:** Ordered identifiers, tool or event names, UTC time, and separate outcome and persistence labels. Failure uses danger text and a danger surface, including when the event was saved successfully.
- **Drawers:** Native modal dialogs provide protected focus, Tab wrapping, Escape dismissal and trigger-focus restoration. Returning to desktop closes the drawer. They reuse pane content rather than displaying duplicate controls.
- **Identity and unavailable pages:** Shared brand and typography, factual scope, specific retry paths, and real return links. No imaginary repository or sandbox context.

The landing headline keeps its narrow, static coral slice. A native SVG code globe replaces the original paper mark. The shared CircuitField is limited to the hero and sign-in screen: twelve original geometric routes use 1px non-scaling strokes at 0.13 opacity. Two introductory green or coral packets each traverse a visible route over 950-1450ms, with 350-1000ms of quiet between them. Three short native SVG dash layers create a tapered head and tail without glow. Mouse movement emits 350ms pulses along the nearest route, throttled to one emission per 180ms and two concurrent pointer packets. Fixed route samples are cached once; each event uses the current SVG coordinate transform. The globe uses 21 curved text bands in a 440px drawing viewport, with alternating native SVG start-offset motion and faint meridians. The gray-and-green code consists of six self-contained JavaScript helpers. A cursor-following magnifier reuses the same SVG source group at a larger scale, sampling the code beneath the pointer. The selected band is highlighted and switches to a reviewed example after 900ms of inspection; it never executes a review or edits a file. The glass has a fine marked bezel and a simple fixed handle, with no rotation or grip pattern. Pointer positioning uses a single queued animation frame and transform-based movement; the lens shifts inward only when needed to keep the fixed handle within the viewport. Arrow keys move the sampling point for keyboard users. Clicking pins the lens, and Escape releases it. A small caption identifies the illustration. The globe and lens animation pause offscreen or in hidden tabs. Reduced motion keeps the bands static and presents the inserted lines immediately on focus. The texture renders statically before hydration; reduced motion and unsupported APIs retain it. Offscreen or hidden pages cancel motion, and unmount clears timers and animations. The sign-in variant adds a radial vignette behind an opaque bordered panel. The decorative SVG is hidden from assistive technology and never intercepts content controls. No animation dependency, canvas, WebGL, external request or scroll-linked effect is used. Native disclosures and the actual repository/session/restore sequence remain unchanged.

The repository discovery dialog opens from the workspace context bar on desktop and mobile. A blurred backdrop separates the workspace from the opaque dialog. Initial focus goes to the search field and Escape returns it to the trigger. Public suggestions show the GitHub owner avatar and the full owner/repository name, with an initial as the fallback. Search status stays in the results region. Selecting a result imports a public source snapshot and selects it in the workspace. While importing, controls are disabled and a live status names the repository; failures remain in the dialog with a retry path. The dialog explains that imports are read-only and public-only.

Transitions use 160ms ease-out for color and borders. Reduced-motion preference disables transitions and animations. Settings has a Personalization section for System, Dark and Light. Its theme previews distinguish the palettes, and five named accents each have coordinated text, selection and button colors for both themes. Preferences apply immediately and persist in the current browser.

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

In **Code**, branch and commit controls share the file browser’s column divider. The branch name sits over Files. The commit selector pairs a short SHA with its subject, followed by the message body in the preview column when present. Menus open beneath their controls and highlight the current selection. The controls stack in narrow panes. History browsing keeps the saved snapshot available through the commit picker and labels it separately from the active preview.

PR reviews send the exact chat message **Code Review this PR** and keep the selected PR beside the conversation on desktop. Phones close the tools drawer to reveal the answer. A restrained processing indicator offers Stop review, with reduced-motion support. Responses use Markdown, numbered source evidence supplied by the model, syntax-highlighted fenced code and explicit Copy code feedback. The PR title and revision stay above the answer. Simulation is labelled before and within its content; failed reviews retain partial text with a separate error. Restored sessions show the latest saved exchange.

Review response bodies sit in a quiet panel message box, using muted prose and softened headings to reduce white intensity. Code-copy controls use 11px text beside a 13px copy/check icon while preserving usable pointer and touch targets.

Conversation questions use content-sized bubbles aligned right with their author label, capped at 85% or 70ch. Repo Surgeon responses anchor to the conversation’s left padding beside a 32px circular avatar containing the activity icon. Only the response content keeps a 70ch reading limit; the exchange itself fills the pane so wide layouts do not center the chatbot. Long content wraps within its message.
