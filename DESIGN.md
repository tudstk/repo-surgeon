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
rounded:
  control: "6px"
  badge: "4px"
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

## Typography

Body text uses the platform sans stack at the body role. Page headings use the heading role; pane headings are 14px/20px semibold. Supporting labels are 12px, repository and session rows remain body-sized. The phone composer uses 16px input text to avoid browser focus zoom.
Code uses the code role. Conversation copy is constrained to 70ch and explanatory copy to 65ch where space permits.

## Layout

The shared header is at least 56px high; a separate repository context row keeps the selection visible. Desktop uses 280px repositories/sessions, a fluid center, and 420px saved events. From 1101px through 1280px the left pane is 260px. Dividers are fixed 1px rules.
At 1100px and below only the conversation is shown in the main grid; labelled buttons open repository/session and event drawers. At 600px and below, spacing tightens, context wraps, and primary controls have a 44px minimum height. The shell uses dynamic viewport height. Conversation and event content scroll within their own areas; the composer stays in view.
Spacing mostly follows 8/12/16/20/24/32px steps. Login content is capped at 440px; account content at 720px. Keep all grid/flex children shrinkable and wrap long user data.

## Elevation & Depth

Flat tonal layering and single-pixel dividers establish depth. No card shadows or decorative glow are used. Modal drawers use a 60% black backdrop and a sticky close toolbar.

## Shapes

Controls and messages use the control radius; small badges use the badge radius. The profile avatar is circular. Icons are original 24-unit SVG paths with consistent rounded strokes; the GitHub mark identifies the login provider.

## Components

- **Header:** Brand and Workspace links, plus a circular GitHub avatar at the right. Hover/focus reveals the username; click opens icon-labelled Profile and Settings links. Menus support arrows, Home/End, Escape, Tab exit and outside dismissal. The trigger is 44px with a 32px image and an initial fallback. Source-file safety remains stated in repository context.
- **Buttons:** Teal primary and outlined neutral secondary actions; stable hover treatments, explicit disabled states, and 2px accent focus outlines with 3px offset. Principal phone actions are at least 44px high.
- **Selection rows:** Native buttons use `aria-pressed`, teal text and a selected surface. Full names remain available through wrapping and titles.
- **Composer:** Textarea focus outlines the shared input container, including its footer, without a nested textarea ring. Inspect keeps its own keyboard focus outline. A visible demo-provider disclosure precedes the bordered textarea. Inspect is disabled without a session, during submission and for instructions shorter than three trimmed characters. Input is capped at 8000 characters.
- **Events:** Ordered identifiers, tool or event names, UTC time, and separate outcome and persistence labels. Failure uses danger text and a danger surface, including when the event was saved successfully.
- **Drawers:** Native modal dialogs provide protected focus, Tab wrapping, Escape dismissal and trigger-focus restoration. Returning to desktop closes the drawer. They reuse pane content rather than displaying duplicate controls.
- **Identity and unavailable pages:** Shared brand and typography, factual scope, specific retry paths, and real return links. No imaginary repository or sandbox context.

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
