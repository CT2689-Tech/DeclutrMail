# Needs first review: empty-Inbox Later suggestion

## Contract and ownership

User intent: review a sender without being encouraged to move nonexistent Inbox
mail. At a known zero Inbox count and a Later recommendation, hide the suggestion
badge and its explanation, including preview Details. Do not replace it with a
made-up recommendation or a New status. Keep positive-Inbox recommendations and
genuinely unscored senders unchanged.

Entry: Senders → Needs first review → expand sender → choose an existing action →
fresh preview → cancel or explicit confirmation → return to review. This repair
changes presentation only. Keep, Archive, Unsubscribe, Later, Delete, shortcuts,
protected acknowledgement, scope/age/return controls, fresh preview reads,
confirmation, completion and Undo retain their existing owners.

Integration owner: this Codex task. Isolated branch:
`codex/first-review-empty-later`, based on `75a44acaa`.
Owned files: Screener row/preview presentation, focused first-review tests,
existing screen stories, and this audit. No dependencies or overlapping open PR
files at the initial check. No shared workers, schema, lockfile or configuration
ownership claimed.

## States and verification plan

| State / transition                                      | Expected UI                                                     | Cache / provider effect     | Verification                               |
| ------------------------------------------------------- | --------------------------------------------------------------- | --------------------------- | ------------------------------------------ |
| Later recommendation, zero Inbox                        | No suggestion badge/reason; existing actions visible            | None                        | Regression and browser                     |
| Expand / preview Details                                | Suppressed reason stays absent; counts remain visible           | Existing preview read only  | Regression and browser                     |
| Explicit Later / L                                      | Existing preview and return control; zero confirmation disabled | No write until confirmation | Regression and browser; cancel only        |
| Positive Inbox / refreshed count                        | Existing Later suggestion returns                               | Existing query behavior     | Regression and browser                     |
| No recommendation                                       | Existing New marker                                             | None                        | Regression                                 |
| Other recommendations, including zero-Inbox Unsubscribe | Existing suggestion retained                                    | None                        | Regression                                 |
| Preview loading / failure / cancel                      | Existing feedback, disabled confirmation and recovery           | Existing query behavior     | Existing focused suites and browser        |
| Completion / protected / Undo / quota / account switch  | Unchanged existing paths                                        | No new effect               | Existing focused suites; no real mutations |

Use the actual local production build with an isolated synthetic account for
desktop and mobile checks. Check the deployed signed-in target read-only after
release. No actual emails may be changed. Billing and onboarding are excluded.

## Result

Implemented one presentation guard shared by the badge, expanded reason and
preview Details. The original recommendation remains in the data model; no
decision, eligibility, request, action or protection handler changed.

- Negative control: the new zero-badge and expanded-explanation assertions failed
  on the original behavior. The repaired first-review suite passes all 12 tests.
- Focused Screener and Guided sibling coverage: 184 tests across 15 files pass.
  Shared/config/events release suites, including the entitlement literal guard,
  pass separately.
- Workspace typecheck, root formatting, Storybook, production build, 50 served
  route bundle budgets, one declared redirect and 32 prerender checks pass. Root
  lint has zero errors and six pre-existing unused-disable warnings outside the
  diff. No budget rebaseline or configuration changes.
- Built-in browser on the compiled production app, authenticated as the isolated
  synthetic account: 1280×720, 320×760 and 390×844. Zero-Inbox Later has no badge or
  reason, including Details. Explicit Later and L still open the existing
  return-time preview; the zero/protected case is disabled. Positive Inbox keeps
  the suggestion and a fresh two-email preview. Four previews cancelled via
  Cancel/Escape. Phone action targets are 44px; no horizontal overflow or browser
  warnings/errors observed.
- Synthetic readback retains the exact fixture labels, zero non-fixture action
  jobs and zero decided queue rows. No worker or provider credentials were
  started. The test tab and services were stopped; no actual emails changed.
- Independent source/design-system review and defect-class sweep: no blocking
  findings; reviewer did not repeat the integration owner's browser/check runs.
  CI, merge queue, deployment and signed-in production verification are separate
  release stages and remain pending at this authored checkpoint.

## Adjacent opportunities and limits

The review noted two pre-existing, unmeasured adjacent cases: zero-Inbox Archive
recommendations and a cached positive queue count whose fresh preview is zero.
They are outside this repair's known-zero Later contract; other recommendations
and cache/action ownership are deliberately unchanged. No new collection,
classification, pricing, provider or mailbox policy is introduced.

Mobile evidence uses responsive browser viewports, not physical devices.
Confirmation, provider completion and Undo were excluded from live testing.
Privacy-safe synthetic screenshots are retained outside the repository.
