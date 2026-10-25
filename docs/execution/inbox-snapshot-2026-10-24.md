# Compact Inbox Report and truthful cleanup feedback

Owner: this session, `codex/inbox-snapshot-20261024`, based on main `c78a43879`.
Own report presentation/entry, Home submission feedback and the shared backlog
submission formatter. No dependencies. PR #1130 owns adjacent sender navigation;
this change avoids its files. Billing, provider behavior, data collection and
real-mailbox mutations are excluded.

## Flow and design contract

Open report → dated snapshot → Review senders (exact suggested IDs) → existing
sender review and mandatory preview → confirmation → shared progress → verified
terminal outcome and Undo. Details optionally expose insight scopes, basis and
bulk cleanup. A snapshot is never an action receipt.

Use existing colors: light card #ffffff / text #2b2730 / muted #6b6473 / accent
#6f568a; dark card #302a32 / text #f4edf1 / accent #d1b8d6. No token changes.
Geist carries the short heading, summary and controls; no oversized animated
number, glyph row, confetti, upgrade or repeated privacy paragraph. Left aligned.

```
Inbox snapshot          Snapshot date            Close
2 senders worth reviewing.                       Review senders
Details
```

This deliberately follows the product's sender-review workflow. A generic stats
dashboard would reproduce the problem, so keep facts collapsed and the review
action prominent. Reuse the existing card border and restrained accent.

| State / transition              | Visible behavior                                | Cache / persistence                          | Verification |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------- | ------------ |
| Loading / error                 | Short status / Retry report                     | Existing scoped query                        | pending      |
| Suggestions / fallback / empty  | Count or neutral no-suggestions line            | Snapshot date and exact set                  | pending      |
| Details / bulk preview / cancel | Optional facts and existing mandatory preview   | No action until confirm                      | pending      |
| Accepted / executing            | Shared progress; no local success               | Mailbox-scoped accepted handle               | pending      |
| Partial / failed / unknown      | Shared result and Activity recovery             | Requested count never treated as moved count | pending      |
| Terminal / Undo                 | Shared terminal affected count and durable Undo | Existing reconciliation                      | pending      |
| Refresh / switch                | No stored optimistic celebration                | Scope stays mailbox-specific                 | pending      |

## Result and evidence

- Default report: title, localized date, one sender-count sentence, Review senders,
  native Details disclosure. No large stat, glyph row, repeated privacy paragraph,
  billing pitch, persisted success banner or duplicate Undo. Empty sets have no
  self-link; Details includes even a single qualifying fallback insight.
- Report/Home no longer turn acceptance counts into archived totals. Shared
  submission text preserves manual Gmail instructions, failures and skips; the
  shared progress/Undo tray owns move completion. Existing synthetic demo result
  formatting remains separate. No backend or provider contract changes.
- Negative control: the compact-view regression and both bulk Archive/Delete
  premature-success assertions fail against the original implementation. Restored
  fixes pass. Removed obsolete reveal/celebration assertions and a CSS grid test
  that no longer describes the product; existing shared lifecycle coverage remains.
- Affected report, Home, Senders, sender-detail, Triage, simulator and shared
  progress suites: 559 tests passed. Final report/Home rerun: 46 passed, including
  the two review corrections. Workspace typecheck passed; final web typecheck,
  workspace lint, production build, 49-route bundle budgets and prerender passed.
  Lint reports six pre-existing unused-disable warnings outside this change.
- Built-in browser on a disposable signed-in synthetic account: Home opens the
  dated snapshot; Review senders opens exactly Fresh Finds Weekly; Details works
  with Enter; mandatory live preview resolves and Escape restores opener focus.
  Light/dark presentation verified. Phone 375px: 220px default card, 44px visible
  controls, no horizontal overflow, including expanded Details.
- Synthetic cleanup acceptance requested 14 and affected 0: UI showed Archiving,
  no Archived success. Injected executing state with affected 5 still did not
  claim completion. A terminal fixture with affected 5 and a valid Undo journal
  displayed Archived 5, never 14. Shared Undo showed Undoing; injected reverse
  completion restored five local labels and cleared the tray. The initial terminal
  fixture lacked an Undo journal and therefore had no success receipt; after
  supplying the complete worker-shaped fixture, the count/Undo UI was observed.
  This is controlled UI/data readback, not worker or Gmail execution proof.
- Switched through the account menu to a second empty synthetic mailbox. Its
  snapshot showed no suggestions and no primary self-link, with prior account
  facts cleared. No console errors were observed in the browser.
- Independent design-system, usability, flow and defect-class review found two
  issues (empty self-link, hidden single insight); both repaired and re-reviewed
  with no further actionable findings. Stories cover full, historical, fallback
  and empty data shapes. Storybook's existing import-assertion runtime limitation
  from the prior audit was not treated as a visual pass; actual Next app rendered.

No provider workers, Gmail credentials, real mailbox mutations, billing actions,
new analytics, collection, permissions or production configuration were used.
Unsubscribe-only feedback remains neutral requested/manual text with Activity;
this change does not claim sender-side delivery. The test-only send-disabled
unsubscribe result stayed visible as a failure while Archive was in progress.

Release checkpoints are separate: this file records local verification. Required
remote checks, merge queue, automatic deployment and public serving readback are
recorded on the PR. Disposable account data and services will be removed after
verification; there is no production test residue.
