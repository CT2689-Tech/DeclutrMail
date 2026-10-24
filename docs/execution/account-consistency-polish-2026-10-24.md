# Account consistency polish

## Flow contract and ownership

People open Settings to change preferences and manage Gmail accounts, and Plan &
billing to understand current access, charges and optional purchases. Preserve one
scrollable Settings page with section anchors and the bottom Account navigation.

This session owns `codex/account-consistency-polish`, based on freshly fetched
main `03cf38ae`. Scope: Billing presentation and its existing projection consumers,
Settings plan summary/notification descriptions, canonical labels, shared editorial
section-link touch areas and affected tests/stories. No open PR currently overlaps
these files. One integration owner; independent design-system/React/copy/flow
reviewer. No API/schema/provider SDK/catalog/price-policy changes or dependent PRs.

Billing entry points remain sidebar, drawer, account menu and deep links. Distinguish
complimentary/included access and Pass grants from a recurring subscription or a new
purchase. Existing subscription prices/cycles, expiry, confirmations, pending-payment
locks, provider gates and recovery remain authoritative. Paid and Pass states use
synthetic fixtures; no real purchase, plan change, Gmail mutation or deletion.

## Findings and intended repair

- Billing showed a catalog annual price under Current plan for complimentary Pro,
  while its actual current card correctly said nothing was owed. Render actual
  access status separately; mark Pass and recurring subscriptions truthfully.
- A lower/equal-tier new purchase was visually primary despite existing access.
  Preserve its existing preview and eligibility, but use a secondary, explicit
  separate-purchase action.
- Settings' secondary plan heading competed with preference headings. Use a quiet
  compact readout and direct Billing link while retaining loading/error/retry.
- Gmail account and Daily Brief labels drifted. Reuse approved vocabulary and send
  account management directly to the original `#mailboxes` target. Browser smoke
  also caught the old `/screener` tool shortcut, which emitted a prefetch error;
  use the existing Cleanup helper and canonical Needs first review destination.
- Mobile section/tool links were smaller than 44px controls. Increase hit areas
  without adding tabs or changing document order.
- Reminder/weekly email categories lacked useful explanations. Describe the real
  producers' triggers and contents without changing consent or delivery behavior.
- Billing repeated Compare plans in its header and contents. Keep the section link
  and remove the redundant header shortcut.

## Verification and evidence

Before: complimentary Pro also displayed a recurring catalog price under Current
plan, and the lower-tier purchase looked primary. After: the comparison names
Current access / Complimentary, keeps actual paid subscription prices and cycles,
and offers a secondary Buy Plus separately action with the existing price and
renewal preview. Pass-only access does not badge a Plus subscription as current.

Local verification on the complete candidate:

- Nine new plan/access regressions pass. Negative control: the old PlanPicker
  fails eight of nine, then all nine pass with the repair restored.
- All 560 Billing/Settings tests pass after final presentation and route changes;
  the final canonical tool label/destination test also passes (7 coverage tests).
- Full web suite: 5,015 pass, three existing skips. Shared/config/events suites
  and the entitlement literal guard pass.
- Workspace typecheck, lint and formatting pass. Lint retains six existing
  unused-disable warnings outside this scope. Derived implementation log is
  current (250 rows). Storybook builds successfully.
- Production build and bundle/prerender checks pass without budget changes:
  49 measured routes within budget, 32 public routes prerendered. The canonical route
  correction was rebuilt and rechecked before publication.
- Built-in browser against isolated production build: complimentary Pro; Pass-only;
  founding Pro actual annual price; scheduled cancellation identity/locked purchase;
  complimentary Pro with paused lower subscription and retained recovery controls;
  optional subscription preview then Not now, with no payment initiated.
- Settings at 1280px and 320px: quiet 13px sans plan heading, direct Billing link,
  notification descriptions, canonical Daily Brief name, anchored scroll/focus.
  All six section links are at least 44 by 44px on phone; included tools are
  44px high. No horizontal overflow. Light/dark, mobile drawer and five workspace
  tabs retain the existing shell. The final canonical tool route was
  checked again after rebuilding: Needs first review renders, its URL is direct,
  and the fresh Billing-to-Cleanup browser flow logs no warnings or errors.
- Independent reviewer authored no implementation. Design-system, React,
  accessibility, copy and flow review source-clear; typed access classification
  and exact Needs first review naming resolve review follow-ups.

Release verification remains separate: protected PR and queue checks, automatic
production deployment, exact serving commit, live signed-in desktop/phone review,
API health/readiness and final scores are reported in the delivery chat. No live
payment, provider mutation, preference write, Gmail change or deletion is part of
this follow-up.
