# Triage sender identity audit — 2026-10-03

## Flow contract and ownership

Returning-user Triage focus card → identify sender → inspect full identity →
close disclosure → inspect Why or choose an existing verb → mandatory preview
for mail-changing actions → confirmation / queued / terminal / recovery as
already defined. Onboarding and billing are excluded. Local synthetic fixtures
cover long and unbroken identities; production account alias R is used only for
read-only verification. No real Gmail action or preference change is required.

Root owns the focus card and stories, swipe hook and tests, focus regressions,
identity assertions in the existing synthetic Keep journey and this record.
Root owns integration. Branch `codex/triage-identity-disclosure` starts at main
`2ff2aa44`. No overlap or dependency with export #868 or Autopilot #867. No schema,
data collection, category policy, action contract, entitlement or dependency change.

## Findings and repairs

**P3 — hover titles cannot reliably disclose a truncated identity on a phone.**
The focus card includes complete accessible text but visually truncates long
names/addresses. Add a native, keyboard/touch-operable Sender details disclosure
that exposes the full already-loaded name and address. Its text wraps unbroken
identities; the collapsed trigger has a 44-pixel target. A new sender's disclosure
starts closed. Opening it leaves the selected sender, Why expansion and decision
state unchanged; it does not request a fresh recommendation.

**P2 — dragging a control also started a card action.** A regression reproduced a
left touch drag starting on the Why button opening an Archive preview. Native
controls, links, editable fields and disclosures now own gestures beginning on
those elements or nested icons/text. The list row's existing role-button header
remains its intended swipe surface; an explicit positive regression preserves it.
Card swipes and canonical action/preview callbacks remain unchanged.

## Verification state

Three new focus cases failed against old behavior before implementation.
The updated focus, swipe, list-row and toolbar suites pass **156/156**, including
normal card swipes, rejected diagonals, native-control exclusions, disclosure
open/close without decision, and reset on Skip. Editable-host coverage includes
empty, true and plaintext-only values; a noneditable card remains swipeable.
Full workspace typecheck and lint pass (six existing warnings, no errors), and
the production Storybook build passes. Independent review found no source blockers
after preserving the list header and completing editable-host coverage. The
disclosed-text fixture is open to represent the actual selection interaction.

Browser verification at 390 × 844 confirms native Enter open/close, retained focus,
44-pixel disclosure/action targets and unbroken text wrapping. In the full synthetic
app the document and viewport are both 390 pixels wide. Expanded content may need
vertical scrolling. Storybook's unbroken-identity card stays within its content
area (334-pixel card, no card overflow), but the Storybook wrapper itself has a
10-pixel horizontal mismatch with its classic scrollbar; this is not evidence of
production card overflow. Screenshots remain private synthetic audit artifacts.

Existing Storybook long-identity coverage remains interactive; a new unbroken
identity case challenges wrapping. The extended isolated Keep Playwright journey
passes **1/1** against the final source snapshot: Enter open/close, unchanged
selected identity, Archive-preview cancellation, Keep, committed Activity/outbox
and reload. Disposable local PostgreSQL/Redis and synthetic mailboxes only.
Native disclosure does not establish provider
completion. The synthetic Keep journey still stops at the synchronous API's
committed decision/outbox boundary; worker consumption and Gmail restoration
are separate evidence.

## Remaining opportunities

Global Screener backlog browsing/filtering beyond its bounded working window
remains a separate flow/API feature. Recommendation age/freshness explanation and
durable Later receipts also remain separate; new retention or production schema
changes require their existing approval boundary. Sentry transport root cause,
authenticated PostHog insight usability and alert receipt remain unverified.
