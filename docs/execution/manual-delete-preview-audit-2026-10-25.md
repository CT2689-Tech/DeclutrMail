# Manual Delete preview consistency audit — 2026-10-25

## Contract and ownership

Audit fresh manual sender cleanup previews for Any age, Include archived email
starting off, selected age/reach governing count and request, and cancel/reopen
reset. All live verification is preview/change/cancel only: no email movement,
unsubscribe request or sender decision may be confirmed. Synthetic tests may
exercise submission against stubs without a worker/provider.

Owner/integrator: this session, branch `codex/manual-delete-preview-audit`, isolated
worktree from current main `faed5664e` after #1149. Scope includes Senders single,
bulk, detail page/pane and scoped Guided Review; Triage sheet/inline focus/list;
Needs first review Delete; Inbox Report's manual bulk cleanup; public demos.
Saved automation predicates, onboarding and billing changes, development-only
prototypes and provider execution/Undo are excluded. No dependency on open PRs.

## Source inventory

| Surface                                               | Preview / action owner                                               | Findings                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Senders list single and selected/scoped Guided Review | ConfirmActionModal / senders-screen                                  | Shared Any age default; archived off; selected age/reach forwarded                                                      |
| Senders bulk Delete                                   | ConfirmActionModal with bulk preview / senders-screen bulk enqueue   | Aggregated eligible counts, protected exclusions, chosen Delete reach forwarded                                         |
| Senders single/bulk Unsubscribe + Delete              | UnsubscribeBacklogDialog / senders-screen confirmBacklog             | Shared Any age on selecting Delete; chosen age/reach forwarded                                                          |
| Sender detail page and side pane, both actions        | ConfirmActionModal / SenderDetailRoute                               | Same shared previews; selected age/reach carried into composite/backlog requests                                        |
| Triage full sheet, focus/list and Guided Review       | ActionSheet / TriageScreen                                           | Any age and archived off; selected count/request match                                                                  |
| Triage remembered inline Unsubscribe + Delete         | inlinePreviewFor / InlinePreviewBlock / TriageScreen                 | Scope control, count/Details/link and button/shortcut reach match                                                       |
| Needs first review                                    | DecidePreview / ScreenerScreen                                       | Delete defaults Any age; archived off; selected scope sent; Unsubscribe is future-only with no Delete add-on            |
| Inbox Report manual cleanup (single/bulk)             | LiveReportFixDialog / UnsubscribeBacklogDialog / first-landing-entry | Fresh preview and shared controls; mode, age and Delete reach forwarded                                                 |
| Public Senders demo (single/bulk)                     | Custom standalone preview; shared Unsubscribe dialog                 | Null age was labelled All inbox/All mail; fix to Any age. Semantics already correct                                     |
| Public Triage demo                                    | ActionSheet / synthetic count owner                                  | Any age impact; archived choice and mode reset correct. Aggregate-only fixture intentionally has no age-filter selector |

Triage domain batches offer Archive/Later, so no Delete preview is omitted there.
Onboarding's first-relief preview remains inbox-only by existing policy. Saved
rules retain their chosen predicates, including a deliberate older-only filter;
they are not fresh manual cleanup defaults. Historical development prototypes
are not production entry points.

## Repair and regression coverage

The public Senders demo conflated age and location in its null option label:
checking archived changed All inbox to All mail. Use Any age at both scopes while
retaining the truthful count suffix. No matching/filter/dispatch behavior changes.

Extend caller-level coverage for bulk and detail page/pane so scope wiring is
verified outside shared components. Actual tests and browser evidence are recorded
below when complete. Independent source audit found no additional functional gap.

## Verification results

- Independent source/test/design/usability review found no functional scope gap
  beyond the public demo label. Its unit-test readiness recommendation was fixed
  and re-reviewed: wait for the async Delete option to become enabled before
  clicking. No blocking findings remain.
- The demo label regression failed before the repair (Any age absent; All inbox
  present). After the repair, its option stays Any age across both scopes and
  retains the correct count suffix.
- Relevant local suites: 133 files / 1,939 tests passed, with three existing skips.
  Strengthened bulk Delete + Unsubscribe controller tests and detail Unsubscribe
  page/pane tests were rerun after adding readiness waits: four tests passed.
  Full typecheck, ESLint (six existing unused-disable warnings), formatting,
  production web build, all 49 route bundle budgets and prerender checks passed.
- Live intended-account browser audit: both actions in Senders single/bulk,
  detail side pane/full page and selected Guided Review; Inbox Report bulk
  Unsubscribe + Delete; Needs first review Delete; Triage full-sheet Delete and
  the remembered inline Unsubscribe + Delete. Every observed preview started at
  Any age with Include archived email unchecked. Bulk widening updated both count
  and scope consistently. All previews were cancelled; selection was cleared and
  no Delete, unsubscribe or review decision was confirmed. Screenshots and exact
  counts remain local, outside the repository.
- Local production-build public demos: Senders Delete opens Any age and archived
  off; checking archived changes the sample count from 111 to 273 while the age
  remains Any age. Its composite preview and both public Triage Delete variants
  also start inbox-only / Any age with archived off. All previews cancelled.
  At 320px, the corrected Senders preview has no horizontal page overflow; the
  temporary viewport was reset.
- New actual-server E2E covers seven cancelled previews: bulk Delete/reopen and
  Unsubscribe + Delete, plus both actions in detail pane/full page. It checks
  fresh defaults, archived widening, explicit older-only zero/disabled, absence
  of mutation POSTs (excluding the read-only bulk-preview POST), and unchanged
  synthetic Inbox/Trash labels. Fixture cleanup restores channels/protection and
  removes its archived message. Added it to the journey command and required
  report inventory; the harness rejects a report that omits this new journey.
  CI execution is recorded in the PR, separately from manual browser verification.

Triage's full-sheet Unsubscribe variant and list renderer have source/controller
coverage; the intended live account uses the remembered inline setting and Guided
Review focus presentation, which were retained. Inbox Report single-sender and
public bulk variants share the audited owners and are covered by existing tests.
No live preferences were changed merely to manufacture another UI variant.

## Opportunities and limits

One bounded copy repair and broader caller-level regression coverage were needed.
No additional collection, new feature or scope policy is needed. Explicit rule
predicates and onboarding's inbox-only restriction remain deliberate exceptions.
Preview-only verification does not claim provider execution or Undo completion;
those were not exercised against a real mailbox. Integration/deployment evidence
and final state are recorded in the PR.
