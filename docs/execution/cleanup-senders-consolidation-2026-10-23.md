# Senders review consolidation

## Scope and ownership

User intent: make cleanup easier to understand and navigate while preserving all
existing email-action behavior. Implement the approved production-layout study,
with ordinary sender details unchanged. The prototype is reference material, not
production implementation code.

Integration owner: root. Isolated branch: `codex/cleanup-senders-guided-review`,
based on `origin/main` at `643f78a16`. The original prototype worktree is preserved.

- Guided-review implementer: Senders/Triage presentation and tests; existing action
  owners remain responsible for previews, dispatch, terminal results and recovery.
- First-review implementer: Screener presentation and the first-review workspace;
  existing Screener reads, capability gate and decide lifecycle remain responsible.
- Root: workspace navigation, routes/hydration, integration, documentation, checks,
  isolated browser verification and PR/merge/release verification.
- Independent reviewer: action contracts, adjacent states and final diff; no edits.

No API, worker, schema, billing, OAuth, privacy, recommendation-engine, eligibility,
retention or recovery-window changes. No real mailbox mutations for verification.

## Flow contract

`/senders` is the Cleanup workspace. All senders retains the current list, filters,
sort, selection, native sender details and action lifecycle. Needs first review at
`?view=first-review` uses the existing Screener queue and capability gate; Next or
opening a sender never resolves first review. Suggested Guided Review at
`?view=guided` uses the existing Triage bootstrap/order/eligibility and dispatch.
Selected/filtered Guided Review snapshots the actual loaded sender IDs,
reads current detail facts, and uses the existing Senders action owner. Loaded
filtered rows must not be described as every matching sender in the mailbox.

Legacy links redirect before rendering to the corresponding Senders view, preserving their query scope. Existing action handlers retain
their surface-specific Keep contract. The canonical verbs remain Keep, Archive,
Unsubscribe, Later and Delete. A visible suggestion changes presentation only.
All mail-changing choices still require the existing preview/confirmation, exact
scope/count/destination/recovery copy, Protected rules and server reconciliation.
Next/Previous navigate locally without writing a decision or moving mail.

| State / transition                      | User sees                                                                      | State / cache effect                                      | Verification         |
| --------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------- |
| All senders / ordinary click            | Existing list and native detail pane/details route                             | Existing query and action ownership                       | Unit + source review |
| Suggested review                        | One existing engine recommendation, factual reason, Keep and remaining actions | Original Triage bootstrap and dispatcher                  | Unit + source review |
| Selected/filtered review                | Snapshot count and clear loaded-senders scope                                  | Existing Senders dispatcher, fresh sender detail          | Unit + source review |
| Next / Previous / Back                  | Clear position and list context restored                                       | Local navigation only                                     | Unit + source review |
| First review                            | Existing eligible queue and authoritative pending count                        | Existing Screener decide/terminal resolution              | Unit + source review |
| Preview / Cancel                        | Current scope and consequence; returns to same sender                          | No action on cancel                                       | Unit + source review |
| Confirm / running                       | Honest submitting/queued/in-progress feedback                                  | Existing owner/locks/polls remain mounted                 | Unit + source review |
| Success / policy decision               | Result and safe progression                                                    | Advance only after durable decision or terminal success   | Unit + source review |
| Failed / unknown / Protected skip       | Existing recovery with sender still unresolved                                 | No invented completion or duplicate submission            | Unit + source review |
| Undo / revisit                          | Existing receipt and current server facts                                      | Existing recovery/reconciliation contracts                | Unit + source review |
| Mailbox change                          | Fresh account context, no stale review snapshot                                | Reset local queue and scoped state; guard stale callbacks | Unit + source review |
| Empty / unavailable / gated / reconnect | Existing designed state and route back                                         | No fabricated count or forbidden query                    | Unit + source review |
| Keyboard / phone                        | One active shortcut owner, visible focus and accessible controls               | Hidden views keep lifecycle, disable shortcuts            | Unit + source review |

## Evidence

Candidate implementation is complete and independently source reviewed. No API,
worker, migration or email-action semantics changed. The following evidence is
local until required CI and browser/release verification complete:

- Guided/actions: 309 tests in six focused suites passed. Final scoped-link,
  keyboard-help and modal-blocking changes: seven tests passed. Final toolbar
  caption suite: 32 tests passed.
- First-review/attention: ten tests passed. Workspace controller/navigation and
  server gating/hydration plus compatibility redirects: 30 tests passed.
- App chrome: 53 tests passed. Shared Sidebar: 17 tests passed, including legacy
  hint names. Existing phone CSS guard: three tests passed after updating its
  selector to find the relevant media block instead of assuming the last block.
- Shared suite: 933 passed initially, with one new-copy glossary failure and
  three scanner timeouts under concurrent host load. Simplified the new help
  wording without expanding the baseline; the four relevant suites then passed
  all 26 tests, including the pricing literal guard and its negative control.
- Config: 38 tests passed. Events: 76 tests passed.
- Broad web suite: 4,926 passed, three skipped, six failed. Four Billing lazy-panel
  assertions and one Sender nudge assertion passed isolated rechecks; the sixth
  was the CSS selector above and passed after its bounded correction. This is
  recorded separately from a clean full-suite result.
- Initial optimized production build passed compilation, lint and type validation.
  Its bundle check exposed streamed alias redirects; compatibility routes now use
  Next configuration redirects, with query-preservation regression coverage.
  Final-source production compilation, bundle budget and browser checks passed after the final suggestion-specific wording correction.
- Independent source reviewer: no remaining actionable findings after readback of
  action contracts, account scope, keyboard help, help ownership and redirects.

Ready, queued, merged, deployed and production verified remain separate states.
No real mailbox/provider mutation was used to produce this evidence.

### Synthetic browser verification

Built-in Codex browser, actual `next start` production build, disposable Postgres
and Redis, no provider worker or real Gmail credentials. Final browser build identity: `ymUOrj_DIoC2K6Y3ixmgF`. The rebuilt candidate was reloaded and its final wording, desktop layout and 320px layout were verified.

Verified native sender inspector, default Suggested Review, selected two-sender
review, Next/Previous/Finish, filtered review restored after reload, Archive
preview count/scope/recovery and Cancel, keyboard help/modal blocking, selected
Keep and Undo, first-review Keep confirmation and pending count 1 → 0. Verified
320px layout without horizontal overflow; Next is visible and 44px tall. Protected
sender retains its reason and Archive-anyway confirmation; Cancel leaves it alone.
The final verified preview is kept open at `http://cleanup-review.localhost:3117/senders?view=guided`.

Navigation and canceled previews left action jobs at 50 and messages at 3, the
synthetic baseline. After explicit synthetic Keep checks, the database had three
Keep receipts, two `triage.verdict_applied` Keep projection events, zero pending
first-review rows, and still 50 action jobs / three messages. Worker consumption
and real-provider mail movement were not exercised by this no-worker harness.

Synthetic sessions intermittently lost cookies on shared `127.0.0.1` and
`localhost` while other task stacks were running. Source review found no
introduced auth/cookie change; cookie collision remained plausible rather than
proven. Final verification used the task-specific `cleanup-review.localhost`
cookie hostname with web/API together. The same-origin local proxy is verification
infrastructure only, outside the repo.

Desktop and 320px screenshots are saved with this chat's visualization artifacts.
Account-switch, unknown/failure and deferred lifecycle cases have integration-test
and source-review evidence; no corresponding real-mailbox mutation is claimed.

At PR preparation, merge, deployment and production verification remain pending;
subsequent release evidence belongs on the PR and in the final task result.

### Final local checks

After freezing the final suggestion-specific wording, all six affected
sender/action suites passed (305 tests), and the complete Shared package passed
(86 suites / 937 tests, including the route-inventory parity, glossary and pricing
literal guards). The inventory now maps both review modes to query-selected
Senders URLs while continuing to check every unique on-disk route and every mode's
edge-state declaration. Normal monorepo typecheck passed; lint passed with no
errors and existing repository warnings. Changed-file formatting and diff checks
passed. Compatibility redirects returned HTTP 307 with the original search scope
and the correct forced review mode. Bundle budget remained within all 50 route
caps without changing the budget table; 32 public static routes were verified.

Required CI will run from the committed, frozen candidate. Earlier broad web runs
are not a clean shipping verdict: the first had the timing/CSS failures described
above; a second overlapped naming edits and had three stale-module/assertion
failures. Fresh affected-suite runs passed, and a later broad run was stopped for
the last copy correction. Do not present those broad runs as green.
