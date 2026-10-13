# Action preview Details — 2026-10-13

## Flow and ownership

Open a sender action → inspect the visible count, destination and Undo boundary →
expand Details → read scope and supporting facts → optionally inspect sample
subjects or check Gmail → collapse, cancel or confirm. This pass covers the shared
Details disclosure and fact list across Senders, Triage, Inbox Report, rule reviews
and synthetic demos. Dispatch, scope eligibility, quotas, Undo/provider policies,
onboarding, billing and production mailbox tests are excluded.

Fresh base: `92d5d4272`. The c970 isolated checkout owns PreviewSheet, SheetFactList,
its visual stories, the synthetic Senders Details markup and focused tests, shared
layout selectors, and this audit. Integration owner: this Codex chat. No dependency
on another PR. Open PR #1037 touches sheet-parts and simulator JSX in separate
regions and implements Unsubscribe safety; this pass preserves those concerns.

## Validation and design plan

Built-in browser reproduced Delete Details at localhost:3137/inbox-simulator with
fictional Northstar Weekly: a floating centered disclosure above three paragraphs
in a flat well. The final paragraph crosses the scrolling-body boundary above the
persistent footer. Source confirms a 32px disclosure target and narrow fact labels
held at 38% width with nowrap/ellipsis even after values drop to separate lines.

Use the existing light palette: card `#fffcf8`, ink `#2d2630`, supporting ink
`#625a63`, muted ink `#685f6b`, and the existing soft-line/fill variables. Geist
and the current text/spacing/radius scales stay in place; themes retain their
existing variables. No token values change.

Layout: a full-width native Details header with the label left and chevron right;
the open header and facts form one quiet flat well. Short labels and readable
values align in rows; both use full available width when stacked on phones.
Supporting links remain a separate row. A bottom inset and a quiet footer boundary
make the scrolling content distinct from confirmation controls.

```
Details                                      chevron
Scope              Inbox + archived · selected age
Gmail Trash        Up to 30 days, unless emptied sooner
Sample context     Explicitly synthetic; current qualifier retained
----------------------------------------------------
                   Cancel                 Confirm
```

The structure serves verification rather than adding decorative cards. Count,
destination and Activity Undo remain visible once above Details. The demo's Scope
and Gmail Trash facts reuse its selected reach/age and established recovery copy;
no extra mailbox data is collected. Native disclosure behavior, keyboard focus,
loading/error guards and the persistent footer are retained.

## Findings and repairs

- P3: centered 32px disclosure and paragraph-only demo facts lacked a clear
  reading hierarchy. A full-width 44px native header now connects to the open
  well. The demo presents Scope and Gmail Trash as semantic label/value rows.
- P3: phone labels stayed at 38% width and ellipsized while values stacked.
  Flexible columns now give both the complete well width when stacked; long
  labels and sender addresses wrap in full.
- P3: the bottom of Details met the fixed footer abruptly. A 16px compact-body
  inset and a soft footer divider separate scrolling evidence from confirmation.
  Expanded content still scrolls in one body; no nested scrolling panel was added.

## Verification and limits

- The selected-scope regression failed against the old paragraph markup, then
  passed with Scope facts that update from 180 to 365 days as the selection
  changes. Eight affected suites passed: 253 tests. No CSS-value snapshot tests
  were added for this presentation change.
- Next production build, all 51 existing bundle caps and 32 public-route prerender
  checks passed. Storybook includes expanded long-text light/dark stories; build
  passed. Workspace typecheck, lint and formatting passed. Lint retains six
  preexisting unrelated unused-disable warnings.
- Built-in browser verified the current production build's synthetic Delete
  preview before/after. At desktop width, the entire well can be read after one
  body scroll; it ends 16px above the footer. At 320 × 568, both buttons stay
  visible (Delete ends at 460.5px, Cancel at 512.5px) with no horizontal overflow.
- The expanded long-text story at 320 × 568 gives each label and value 230px;
  none of the labels truncates. Its disclosure is 44px high. Keyboard Tab reaches
  Check in Gmail above the footer; Enter and Space collapse/open the native
  disclosure with a visible 2px focus outline. Escape on the real demo restores
  focus to the Delete trigger. The review variant and dark-mode story also
  render with the intended hierarchy and theme variables.
- Independent design-system/flow review and exact ready commit are recorded in
  the PR. Source review and local/CI verification remain distinct from production
  serving or Gmail provider behavior. This pass opened/cancelled previews only;
  no real mailbox, provider, billing or infrastructure writes occurred.

## Remaining opportunities

Existing Gmail verification links and subject samples retain their per-surface
coverage. Adding new matching-subject metadata to specialized Unsubscribe previews
would be a separate product/data change; it remains deferred. The current change
improves presentation of available facts without collecting more mailbox data.
