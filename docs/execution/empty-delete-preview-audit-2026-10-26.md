# Empty Delete preview audit — 2026-10-26

Owner/integrator: Codex, `codex/empty-delete-preview-audit`, isolated worktree
from `c4c031254`. No dependency on open PRs. CI mirror recovery is owned by the same integration session. Owned surfaces: shared cleanup
impact, Senders confirmations (single/bulk/detail), Triage sheet/inline and
their fresh preview data wiring, regression tests and this audit.

## Flow contract

The user opens Delete or Unsubscribe + Delete and sees the count for the
selected age and Inbox/archived scope. A settled zero must distinguish verified
no current mail from excluded mail and offer a useful preview-only next action.
Zero remains unconfirmable. Widening filters changes the preview, never dispatches
an action. Cancel returns to the sender/review without changing mail or decisions.
Unsubscribe only remains a separately confirmed future-email action.

| State / transition                                   | Required visible behavior                                    | Verification |
| ---------------------------------------------------- | ------------------------------------------------------------ | ------------ |
| Inbox and all-mail totals both zero                  | No Inbox/archived mail; cancel or choose Unsubscribe only    | Pending      |
| Selected age excludes current scope                  | Explain age filter; Use Any age                              | Pending      |
| Inbox empty, archived matches                        | Explain location; Include archived                           | Pending      |
| Age and Inbox scope both exclude mail                | Explain filters; Show all email widens preview               | Pending      |
| All Protected / excluded bulk                        | Explain no included senders; change selection                | Pending      |
| Partial Protected bulk                               | Counts and empty claims cover included senders only          | Pending      |
| Loading, failed, missing all-mail count, sender gone | Keep existing blocked/retry state; never claim mailbox empty | Pending      |
| Positive, reopen, cancellation, keyboard / phone     | Existing count, scope, disabled-confirm and reset contracts  | Pending      |

## Findings and scope

The common impact rendered every zero as “No emails match these choices.”
Senders had some header/reconciliation logic, but Triage did not carry unfiltered
all-mail totals to its preview. Composite previews could recommend changing age
even when no current mail existed. These are bounded copy/data-wiring gaps;
matching, permissions, action dispatch, automation and Undo are unchanged.

Onboarding, billing, saved rules, provider execution and real mailbox changes
are excluded. Needs first review already distinguishes fresh verified no-current-mail from an
age-filtered zero and offers its explicit Keep review-only path; that policy is
retained and its existing suites passed.

No new data collection is needed: existing fresh preview counts
support the explanation. Loading/error/missing counts remain unknown, not zero.

## Verification and integration

- Final affected web suites: 138 files / 1,990 tests passed; three existing skips.
  Shared scope-copy tests: 38 passed; UI glossary: four passed. E2E report harness:
  23 passed and now requires both cases in the manual-preview file.
- Negative control: restoring the old CleanupImpact made 12 new reason/action
  assertions fail. The repaired component passed. Independent review then found
  two scope-truth issues (upstream exclusions and unqualified no-mail wording);
  both fixed, with a regression for upstream Protected exclusions. Final
  independent design/copy/correctness/privacy review passed with no findings.
- Full typecheck, ESLint (six existing warnings), formatting, Storybook build,
  production web build, all 49 route budgets and prerender checks passed.
- Built-in browser, isolated synthetic account: Senders archived-only Delete and
  Unsubscribe + Delete explain the excluded scope; Include archived changes zero
  to one without dispatch. Age-filtered zeros offer Use Any age, preserving reach.
  Show all email resets age and reach together and produces one matching email.
  Triage sheet verified genuine no-current-mail Delete and composite states;
  Choose Unsubscribe only selects the future-only radio, still requiring confirm.
  Remembered inline composite verified age exclusion at Inbox and archived scope,
  correct positive counts after resetting, and focus on the changed control.
  At 320px the page has no horizontal overflow; viewport restored.
- A freshly empty sender detail page already disables Delete before a preview,
  explains no current mail, and defaults Unsubscribe to its future-only choice.
  This eligibility policy is retained. Component regressions cover a preview
  becoming truly empty after opening; no production mail is moved to manufacture it.
- Synthetic database and app copies are isolated, contain no Gmail credentials,
  and start no worker. A local native compiler cache prerequisite was resolved
  without changing the repository launcher or passing provider credentials.
- Initial CI executed the new preview cases successfully, then caught a fixture
  JSON restore defect that broke later setup. Corrected the edited restores to
  native `sql.json`, added a cleanup readback assertion and rehearsed the exact
  lifecycle against isolated PostgreSQL. See the linked mistake log.
- Extended actual-server CI journeys exercise seven bulk/detail age recoveries,
  inline recovery, genuine-empty Triage and archived-only Senders/Triage variants,
  focus restoration, cancellation, no mutation POSTs and unchanged synthetic labels.
  Their execution and required queue/deployment checks are recorded in the PR.

Post-merge production checks remain preview/change/cancel only, including both
Delete variants in Senders and Triage. No email action or unsubscribe request may
be confirmed. Production verification and exact serving release are recorded in
the PR; local evidence above is not a deployed-behavior claim.

## Opportunities and limits

Implemented the bounded reason/next-action gap using existing fresh count fields;
no new collection, matching policy or feature is needed. Unknown counts retain
neutral wording, excluded bulk claims cover included senders, and original
error/retry and confirm gates retain priority. Provider execution and Undo are
out of scope. Live data may not contain every genuinely-empty transition; do not
create it by changing a mailbox merely to generate evidence.

## Required-check recovery

All 46 actual-server journeys passed on the corrected fixture commit. An unrelated
exact dark screenshot comparison failed at 320px; independent inspection found
34 changed pixels only at two circular indicator edges, with identical text and
layout. The same app/render code passed on the preceding commit. One diagnostic
rerun then failed before any browser test, after three bounded Ubuntu dependency
download timeouts. Initial evidence and rerun outcomes remain in the PR.

A bounded installer fallback now changes only the known Azure Ubuntu origin to
the official HTTPS archive after a failed attempt. The source list's metadata,
signing configuration, attempt budget, privilege boundaries and coverage gates
remain intact. Twelve helper tests passed; restoring the old installer failed the
new ordering/fail-closed regressions. Desktop invocation is a guarded no-op.
Fresh CI must execute all required browser checks before merge.
