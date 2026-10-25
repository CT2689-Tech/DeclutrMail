# Autopilot clarity and Senders alignment

## Ownership and contract

Integration owner: this session. Fresh main base `fd87d71c`. Owned scope: Autopilot web components, their styles, stories and tests, and this record. No API, worker, schema, billing, theme-token or Senders implementation changes. Depends on the merged rule customization and exact approved-batch lifecycle from #1133/#1126. Concurrent Home and billing PRs do not overlap this scope.

Intent: understand what Autopilot found, review the proposed action, approve a precise batch, see Schedule defer it, and recover through Undo. Rule creation and condition/action editing remain discoverable without filling the review queue with forms.

Discovery → Needs review → select rule/senders → existing preview and confirmation → approved batch with waiting/running status → Activity/Undo → refresh/revisit. Your rules holds configuration, saved-rule previews and optional activation. No approval or activation happens by navigating views, selecting rows or saving a rule.

Pending rows are recorded rule/sender matches, not current email totals or completed actions. A sender can match multiple rules. Current preview is authoritative; keep approximate/capped totals and unknown states explicit. Stopped/orphan rules cannot approve. Protected, quota, stale-version, approval conflicts, exact frozen scope, Schedule and Undo behavior are unchanged.

Production account verified through visible identity; production observation is read-only. Browser tests and mutations use synthetic fixtures/isolated accounts. Onboarding, billing, real mailbox mutations, production settings changes and automation policy are excluded.

## Design plan

Reference: current Senders list and related preview controls, plus ADR-0016. Reuse existing tokens: light background #f7f6f9, card #ffffff, ink #2b2730, secondary #5e5866, plum #6f568a, line #ebe8ef; dark inherits its existing values. Geist body and headings in light; existing display role in dark. Names and actions lead; counts are tabular data, not decorative hero statistics.

Layout:

```
Autopilot                         Settings · Pause all · New rule
Needs review                       Your rules
Compact confirmed watching / automatic status
Review explanation + recorded-match count
┌ Rule name · proposed action                         Preview ┐
│ checkbox · sender identity · recorded evidence · Skip       │
│ Select/review controls, existing confirmation flow           │
└─────────────────────────────────────────────────────────────┘
Approved batches / Schedule / Undo remain visible in review
```

Self-critique: remove the oversized slogan and three-step diagram; avoid another competing hero or invented metric. Separate review from management with two familiar views, keep New rule visible, and make recorded diagnostics optional. Use the same neutral containers and readable row hierarchy as Senders. Keep action preview mandatory and do not imply a recorded match is currently eligible.

## Findings and acceptance

- Reproduced: an oversized explainer, complete rule library, approved-batch empty block and activation banner precede the actual review work. Repair: task-based navigation and compact status.
- Reproduced: Pending suggestions has no plain meaning; group headers mix rule origin with observation-window jargon. Repair: Needs review, explicit recorded-match explanation and proposed action at the group.
- Reproduced: desktop row metadata competes for width, truncating identity and scattering diagnostics. Repair: identity-first rows; evidence below identity; optional technical detail.
- Reproduced: editing a rule unfolds a long single-column form and legacy diagnostics. Repair: paired condition fields and separate diagnostics disclosure.

Verify loading/error/unknown totals, no matches, paused/orphan rules, selection and capped review, preview cancellation, rule save/cancel/stale failures, queue/Undo preservation, account hydration, mobile/light/dark and keyboard focus. Existing backend lifecycle suites remain the policy source; this change does not add provider behavior. Independent review required before PR integration.

## Verification and limits

- 222 Autopilot web tests pass, including selection/draft preservation across views, new-rule navigation without writes, first approved-batch focus, removed opener recovery, custom-only review, custom-read failure/retry, and independent preset-read failure. Existing approved-batch tests retain Schedule, partial/unknown status, expiry and Undo restoration checks.
- 953 shared tests (including UI glossary), 22 E2E harness checks, all workspace typechecks, full lint (zero errors; six existing unused-disable warnings), formatting, production Next build, all 49 route budgets and 32 public prerenders pass. Storybook builds with integrated Workspace default/loading/error/empty/customization stories.
- Negative control: hiding ready custom batches makes the custom-only review regression fail; restoring the implementation passes it.
- Built-in browser, synthetic component transport: 320px dark, 375px light and desktop layout; no viewport escape; numeric/action draft preserved across views; keyboard Cancel returns Edit focus; exact custom preview changes12→9 after exclusion, Cancel returns opener, synthetic approval shows batch progress and focuses Approved batches. The synthetic transport does not prove Gmail completion or provider Undo; those behaviors were not changed here.
- Production baseline inspected read-only as the visible signed-in account. No real rule saves, Schedule changes, approvals, unsubscribe or Gmail mutations were performed.

## Scope decisions

Implemented: Senders-style neutral list hierarchy, separate review/management views, compact truthful status, custom and preset review discovery, optional recorded diagnostics, paired condition fields, visible Edit/New rule and preserved previews/approval lifecycle.

Deferred: changing when/how rules act, merging incompatible custom-email and recorded sender-match totals, and a new backend freshness contract. None is needed for this visual/clarity change; the exact current preview remains the decision point. No new data collection, tier policy or provider permissions.

Delivery and independent review evidence are recorded on the PR. Browser CI must validate the changed navigation against the isolated real API before merge.

CI follow-up: the first real-API journey run reached the updated counts and rule views, but an optional account feedback prompt covered lower controls. The Autopilot journey now uses the same visible Skip dismissal as the Schedule journey before proceeding. No forced clicks, prompt suppression, shell changes or production account writes were added. Onboarding remains outside this repair scope.

Integration follow-up: both Autopilot real-API journeys passed on c44db702, but the shared Home recovery fixture raced its read-only peek against the durable visit write. The trace showed peek3/2, then the test changed timestamps, then POST stored0/2; reload correctly returned the persisted0. The fixture now waits for the new persisted3/2 visit before changing its inputs. Original navigation/reload assertions remain; Home product behavior is unchanged. This session also owns that narrow shared-test synchronization for integration; no dependency rebase or test bypass.
