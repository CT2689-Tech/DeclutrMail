# Cleanup flow audit — 2026-10-02

## Scope and contract

Flow: Senders search/filter → Sender Detail → live action preview → Archive →
terminal result → Activity → Undo → revisit sender → verify restored Inbox in Gmail.
Related manual-cleanup preview surfaces: Triage single/batch/inline, Screener,
Brief Noise archive and Activity failed-action recovery. Onboarding, billing and
Autopilot execution are excluded. The returning production test account is referred
to as **Account B**; its identity was checked in the app and Gmail. It has
complimentary Plus, so this is not evidence of Free-plan behavior.

Primary agent owns the branch, frontend repairs, audit/runbook and integration.
Independent reviewer inspected the implementation and prompt; the reviewer authored
only the Activity Undo regression, which the primary independently inspected and
negative-tested. No API, schema, worker or billing contract changed. Shared ownership:
PreviewSheet and focus trap; no dependency on another open PR.

The action must state account, count, destination and Undo; waiting is not success.
Cancelled/zero-count previews must not submit. Undo must reach a confirmed terminal
state, refresh related queues and restore the original message location.

## Implemented findings

| Priority | Gap / evidence                                                                                                                                                          | Repair and verification                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Mailbox identity was behind collapsed Details in cleanup previews; prior QA accidentally used an older browser session.                                                 | Identity is always visible in seven manual-cleanup preview/recovery surfaces. Regression tests assert visibility and no Details ancestor; synthetic phone/desktop browser verified.                      |
| P1       | Loading Archive preview left focus on the page behind the modal because its preferred button was disabled. Reproduced in the isolated browser and a failing regression. | Disabled primary falls back to Cancel. Closed Details contents are excluded from the focus cycle while summary remains reachable. Enabled and destructive initial focus have separate regressions.       |
| P2       | Activity Undo refreshed Senders but omitted fresh Triage/Screener caches (source-confirmed).                                                                            | Both queues refresh on successful or failed reverse jobs, since partial restoration is possible. Tests seed fresh caches and assert observed data changes; removing invalidations makes both tests fail. |
| P2       | Unchecked unsubscribe capability was described as absent in Detail and an active filter chip.                                                                           | Shared capability normalization distinguishes unknown from none; copy says unchecked or “No known unsubscribe.” No filter or eligibility semantics changed.                                              |
| P2       | Highlighted Unsubscribe explained its availability only on hover.                                                                                                       | Visible one-click availability text accompanies the highlighted action, distinct from optional suggestions.                                                                                              |
| P2       | Search widening described failed narrow results more prominently than the effective scope.                                                                              | Notice explicitly states all activity levels or filters removed, with total matches; does not claim every paginated result is visible. Existing widening/restoration tests pass.                         |
| P3       | A single search result read “1 senders” in production.                                                                                                                  | Singular/plural count label corrected, including default active view.                                                                                                                                    |

## Evidence and limitations

### Production baseline — Account B

- Search found the selected sender; detail showed 2 Inbox / 805 archived.
- Live Archive preview resolved to 2, with the correct account and Inbox-only scope.
- Confirmed exactly that reversible Archive: terminal “Archived 2,” 0 Inbox / 807 archived.
- Followed sender-scoped Activity; Undo reached “Undone.” Returning to sender showed
  2 Inbox / 805 archived and an Undone timeline entry.
- Followed the account-specific Gmail link and narrowed to the sender in Inbox:
  exactly two result rows, both with Inbox labels; Gmail account identity matched.
- No Delete, Later, Unsubscribe, protection, rules, plan or onboarding mutations.
  The Archive and its Undo remain as truthful audit history; no mailbox-location
  change remains from this test.

These observations verify deployed baseline behavior, not deployment of this PR.
A previous Account A test was undone before switching; its UI restoration was
verified, but independent Gmail restoration was not checked. It is not evidence for
Account B. The session-selection mistake is recorded separately in `docs/log/mistakes/`.

### Changed build — isolated synthetic stack

Disposable PostgreSQL database `declutrmail_e2e_flow_audit`, isolated Redis DB 12,
loopback API/web, source snapshot excluding environment files, no provider worker or
real tokens. All database migrations and synthetic seeding completed successfully.

- Sender Detail's unknown unsubscribe state accurately says it has not been checked.
- Account identity visible while Details is closed in Archive preview.
- 390 × 844 phone and 1280 × 900 desktop layouts fit without horizontal overflow.
- Loading modal focus reproduced before repair, then verified inside the repaired
  dialog. Zero-window preview disables Archive; Escape closes and restores opener.
- Keyboard Tab wraps inside the dialog; no browser warning/error logs in this smoke.
- Local stack cannot prove Gmail worker execution; production round trip above is
  separate evidence. Recovery/failure/queue-cache edge cases are integration-tested,
  not deliberately induced in a real mailbox.

### Automated verification

- Full repository typecheck passed; lint passed with seven existing unused-disable
  warnings in untouched files.
- 582 tests across 12 affected feature/shared-sheet suites passed, including
  disabled/hidden, visible cycle, enabled and destructive keyboard-focus cases.
- Negative controls: original account-visibility/unsubscribe tests failed before
  repair; loading-focus assertion failed before repair; both Undo cache tests failed
  when new invalidations were removed, then passed after restoration.
- Final Storybook and production web builds passed. All 51 served-route bundle
  budgets and the prerender contract passed.
- No automated real-provider end-to-end suite was run. The repository's isolated
  harness lacks a provider worker; manual CUA checks cover the browser boundary.

## Remaining opportunities and explicit deferrals

| Priority / type             | Opportunity                                                                            | Evidence and next acceptance criteria                                                                                                                                                                                      | Disposition                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P2 / usability feature      | Explicit “Search all senders” scope choice when current filters hide some suggestions. | Production suggestions included quiet/dormant matches while Active results had one match. Preserve search text; show effective scope; return to original filters; test mixed and zero-match cases.                         | Product choice asked: keep filters with an expansion action versus all-sender search by default. No silent default change. |
| P2 / data presentation bug  | Decode provider HTML entities in preview snippets.                                     | Production snippets exposed entity encodings while Gmail rendered punctuation. Use synthetic encoded snippets; investigate a consistent provider/presentation boundary; render decoded text safely without HTML execution. | Follow-up needed; not repaired in this confirmation/Undo PR.                                                               |
| P2 / automation consistency | Always-visible mailbox in Autopilot confirmation.                                      | Source sweep found the account fact still appended to collapsed Details in ConfirmModalFrame.                                                                                                                              | Separate automation flow; avoid representing it as fixed here.                                                             |
| P3 / useful data            | Show an on-demand Inbox age breakdown beside cleanup choices.                          | Current preview already computes age-window counts. Expose those existing counts where they help choosing a window; state Inbox scope/freshness and avoid a request for every list row.                                    | Enhancement candidate, requires a small design choice and performance check.                                               |
| P3 / outcome feature        | Richer Undo receipt for partial restoration.                                           | Recovery already distinguishes partial/unknown outcomes; a user may need what returned versus what could not.                                                                                                              | Validate available provider outcome fields first; never invent counts or say restored while queued.                        |

The feature/data list is a prioritized follow-up set, not a claim that those features
were implemented. This pass does not certify all product flows or every browser.

## Reusable workflow

Canonical prompt: `docs/runbooks/user-flow-audit.md`. Installed local skill:
`$declutrmail-flow-audit` (validated with skill-creator's validator). It requires one
bounded journey, account verification, evidence-based fixes, opportunity triage,
questions for material ambiguity, independent review and a PR. It excludes onboarding
and billing unless explicitly selected, and never implies merge/deploy permission.

Independent review and focus follow-up review found no remaining blockers; sibling
findings were repaired above or explicitly deferred. The final source snapshot was
rechecked in the local browser: loading focus lands on Cancel, zero-count Archive
stays disabled, and Tab stays within visible controls. PR integration status is
recorded separately. No merge, queue entry or deployment was performed by this audit.
