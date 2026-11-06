# Repo Surgeon

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers investigating public GitHub repositories are the confirmed primary audience.
Desktop sustained work and phone session checks must both be usable.

## Product Purpose

Repo Surgeon is a human-controlled repository investigation tool.
Its long-term product loop connects bounded reading, evidence, proposals, isolated tests and explicit approval.
The current authenticated release offers read-only inspection demonstrations and account-scoped persisted sessions.

## Capabilities and Constraints

GitHub sign-in identifies the user through their public profile; it does not import repositories.
The workspace shows repositories already assigned to the account.
The deterministic demo provider lists files and returns a fixed completion message, not tailored answers.
Sessions, turns and normalized events are saved; repository files are not modified and no Git commit is created.
Only the latest exchange is displayed when restoring a session.
The GitHub avatar menu links to Profile and an authenticated informational Settings page; appearance/provider settings are not editable.
Public GitHub import, proposals, sandbox execution, approval, application and a complete audit ledger are unavailable in this UI release.
Existing local operator read/search/investigation capabilities remain separate from the public authenticated workspace.
No browser capability flag identifies deployment mode; never infer it from the hostname.

## Brand Commitments

Keep the Repo Surgeon name.
The confirmed redesign reference is DeepSource, interpreted originally through a calm, dark-first developer workspace.
Do not copy DeepSource branding, assets or unsupported product claims.
The public landing preview uses the user-pinned cyberpunk/wabi-sabi direction: oversized typography, a single charcoal ground, existing green and a coral accent passing through the text. This direction is scoped to `/landing`; the working application retains its established interface.

## Evidence on Hand

The existing typed API clients and deterministic test fixtures establish current behavior.
The master build plan describes future milestones, not shipped capabilities.
No commercial proof or useful general AI answers are supplied.

## Product Principles

- Backend authorization owns safety; presentation cannot grant write capability.
- Keep repository content confined and untrusted.
- Preserve same-origin identity, no-store reads, CSRF, private-state clearing and async response guards.
- Distinguish durable saving from tool or run success.
- Explain unavailable functionality directly with usable navigation.

## Accessibility & Inclusion

Keyboard operation, visible focus, WCAG AA contrast, reduced motion, 200% zoom and conversation-first mobile access are required.
