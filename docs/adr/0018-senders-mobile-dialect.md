# ADR-0018: Senders mobile dialect

- **Status:** Accepted — core dialect shipped 2026-08-30 (see
  "Implementation status" at the end of this document for what landed
  vs. what remains open follow-up work).
- **Date:** 2026-06-03
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D37 (Triage mobile vertical-card + swipe), D54 (Senders mobile vertical-card + bottom-sheet drawer + horizontal-scroll chips)
- **Related ADRs:** ADR-0016 (visual language Layer A inherited), ADR-0019 (Verb Registry inherited)
- **Related spec:** docs/spec/senders-v2.md v1.2 — Decision 8

## Context

ADR-0016 (visual language) is desktop-only. Spec v1.2 Decision 8 locks the mobile pattern at "D54 verbatim + (a) swipe-right row = primary CTA, (b) long-press row = multi-select mode, (c) hairline-divided rows in place of cards stacked." This ADR formalizes the mobile dialect that inherits from ADR-0016 Layer A and overrides specific surface behavior for phone-width viewports.

Phase 4 in spec v1.2 (acceptable post-launch) — this ADR is a placeholder that locks the contract early so Phase 2/3 FE work doesn't accidentally constrain mobile choices.

## Decision

### Breakpoint

Mobile dialect applies when viewport `< 600px`. **Amendment (2026-08-30):**
`tokens.breakpoint` has since moved to `{ xs: 480, sm: 900, md: 1100, lg:
1280 }` — `sm` is 900px today, not the 600px it was when this ADR was
written, so `useIsAtMost('sm')` is no longer the right gate for a
phone-only dialect (it would also catch small tablets). The shipped
implementation gates on `useIsAtMost('xs')` (480px) instead — the
nearest existing token to this ADR's original 600px intent, and the
ceiling `SenderListRow` already used for its pre-existing `sm`
(tablet-narrow) tightening. Tablet widths (`xs` false) keep the desktop
Grid/Table choice untouched, matching this section's original intent.

### Layout

```
┌──────────────────────────────┐
│ Your senders                 │  ← compact header
│ 30d · 191 msgs               │
├──────────────────────────────┤
│ [chip][chip][chip][chip] →   │  ← horizontal-scroll chips
├──────────────────────────────┤
│ [LI] LinkedIn          47  › │  ← row L1: avatar + name + volume
│      linkedin.com            │
│      today · 8% read         │  ← row L2: domain + facts
├──────────────────────────────┤
│ [BA] Bank of Am.       4   › │
│      bankofamerica.com       │
│      2d · 75% read · prot    │
├──────────────────────────────┤
│ ...                          │
│                              │
│         [+ select]           │  ← bulk-mode FAB
└──────────────────────────────┘
```

### Rules

| Surface                  | Mobile override                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Card chrome              | Replaced by hairline-divided rows (no card stacking)                                            |
| Avatar                   | 36px (slightly larger touch target than desktop's 40px is on its own row)                       |
| Volume number            | NumericDisplay `display` variant (Fraunces 28px); not `hero` (40px would overwhelm phone width) |
| Sparkline                | Hidden on collapsed row; revealed on tap-expand                                                 |
| Stat strip               | Inline L2 dot-separated: `today · 8% read · 0 replied`                                          |
| Primary CTA              | Hidden on collapsed row; revealed via swipe-right OR tap-expand                                 |
| Overflow `⋯`             | Hidden on collapsed row; revealed on tap-expand                                                 |
| Chip row                 | Horizontal snap-scroll, all chips reachable                                                     |
| Sort menu                | Bottom-sheet drawer on tap                                                                      |
| Search                   | Full-width when tapped; collapses to icon when not                                              |
| Live ticker / status bar | Hidden (mobile real estate precious)                                                            |
| Magnitude bar            | 1px bottom of row, full-width                                                                   |

### Gestures

- **Swipe-right** on row → primary CTA (context-aware per Verb Registry `deriveDefaultPrimary`). Snackbar w/ undo per D226.
- **Swipe-left** on row → tap-expand inline detail (subjects + List-Unsub URL behind toggle + headers per Decision 10)
- **Long-press** on row → enter multi-select mode (checkboxes appear, bulk-mode FAB shows count)
- **Tap row** → tap-expand
- **Tap chevron** → tap-expand

### Touch targets

All interactive elements ≥44×44 per WCAG. Avatar tap = 36×36 visual + 8px invisible hit padding.

### ConfirmActionModal mobile variant

Bottom-sheet on phones (slides up from bottom, snaps to ~75% viewport height). Chip rows wrap. Custom value-+-unit collapses to one row.

### Bulk-mode FAB

Bottom-right floating action button (`+ select`) when 1+ row selected. Tap → bottom-sheet action menu w/ K/A/U/L/D buttons + Cancel.

### Edge states

- Loading: row-shape skeleton (same as desktop, 1-col layout)
- Empty: existing EmptyState component (no override)
- Error: existing ErrorState component (no override)
- No active mailbox: redirect to picker per existing `CurrentMailboxGuard` 4xx flow

## Implementation in Phase 4

PR shape:

1. New `apps/web/src/features/senders/mobile/sender-row-mobile.tsx` component
2. `senders-screen.tsx` switches on `useIsAtMost('sm')` between desktop grid/table and mobile row list
3. New gesture handlers via `react-use-gesture` or hand-rolled `pointerdown/up` (decide in PR)
4. `ConfirmActionModal` adds `variant: 'sheet' | 'modal'` prop driven by viewport
5. Existing D54 chip + sort scroll patterns preserved
6. Mobile Storybook stories per D210
7. Playwright mobile-viewport tests (375×812)

## Alternatives considered

**A. Force desktop layout on mobile (today's behavior).**

- Rejected: Tap targets undersized, Fraunces 40px volume on phone = overwhelming, 4-column grid wraps to 1-column w/ tiny cards.

**B. Native mobile app instead of responsive web.**

- Rejected: out of scope; existing PWA already serves mobile users. Native is a separate strategic question.

**C. Tabs-on-mobile instead of swipe gestures.**

- Rejected: swipe gestures match mail-app convention (Gmail, Apple Mail, Spark). Tabs would feel unfamiliar.

## Consequences

### Positive

- Phone users get a usable mailbox-cleanup tool
- Gestures align w/ mail-app convention (low learning curve)
- Shared Verb Registry + NumericDisplay primitives mean mobile inherits all desktop alignment work

### Negative

- ~300 LOC FE new code + Storybook + Playwright
- Gesture library OR hand-rolled gesture code = new dependency / new surface to maintain
- BottomSheet variant of ConfirmActionModal adds modal complexity

### Neutral

- D37 (Triage mobile) pattern shares same row + swipe + long-press lexicon — Triage can adopt this dialect's helpers when its mobile pass lands

## Verification

- Playwright mobile-viewport tests (375×812) for: swipe-right → action → undo, long-press → multi-select → bulk action, tap → expand → collapse
- `useIsAtMost('sm')` switch verified across breakpoints (599 desktop, 600 transition, 601 mobile)
- Storybook mobile stories per row state (collapsed, expanded, selected, empty)
- `design-system-agent` review
- `flow-completeness-auditor` review on swipe state-machine

## Implementation status (2026-08-30, closes D54)

**Shipped in this PR:**

- Phone dialect gate: `useIsAtMost('xs')` (480px) — see the Breakpoint
  amendment above.
- Hairline row list (no card chrome) replaces the Grid/Table toggle
  outright at phone width, extending the existing (previously
  unreachable — see LEARNINGS.md 2026-08-30) `SenderListRow` in place
  rather than a new `sender-row-mobile.tsx` file.
- Swipe-right → this row's derived primary verb (same `onAction`/D226
  preview path the button uses — a gesture can never bypass the
  preview); swipe-left → tap-expand; long-press → enter multi-select and
  select that row. Live drag-hint overlay mirrors the D37 triage card.
- Checkbox hides on a collapsed phone row until `selectMode`; the
  primary CTA + `⋯` overflow move into the expanded `SenderRowDetailLive`
  panel instead of the collapsed row (matches the "hidden on collapsed
  row" rules table above).
- `ConfirmActionModal` gained `variant="sheet"` — the same D226 preview
  content, pinned to the bottom edge and full-width on phone, in place of
  a new bottom-sheet copy.
- Bulk mode: `SelectionFab` ("N selected" pill, bottom-right) replaces
  the desktop `SelectionBar` at phone width; tapping it opens the K/A/U/L/D
  set as a full-width stacked list inside a new generic `BottomSheet`
  shared primitive.
- New shared primitives: `useLongPress` (touch-only, drift-cancelled) and
  `BottomSheet` (`packages/shared`).

**Deferred (not in this PR — filed as follow-up, not stubbed):**

- Chip row (activity/filter chips) horizontal snap-scroll — `ComposeStrip`
  still wraps on phone today rather than scrolling. Functional, not to
  this ADR's exact mock.
- Dedicated sort bottom-sheet drawer — no sort control ships in the
  phone dialect list in this PR; sort defaults to the same order the
  BE returns. A future PR can add a sort trigger.
- Playwright mobile-viewport (375×812) specs for the gesture flows named
  above — this codebase's convention (see `triage/use-swipe-verb.test.ts`)
  tests the pure pointer-delta resolver rather than simulating real
  `PointerEvent`s in Playwright/RTL for gesture wiring, which this PR
  follows (`sender-list-row.test.tsx`); the gesture pipeline was smoke-
  verified end-to-end in a real browser (Storybook + Playwright, touch
  pointer dispatch) during review, but no such spec is checked in.
