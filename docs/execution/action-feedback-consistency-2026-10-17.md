# Archive, Delete, Later and bulk action feedback

## Flow contract

The user confirms a preview on Senders, sender detail, Triage or Home Noise.
Archive removes inbox labels; Later waits until the confirmed return time;
Delete uses the confirmed inbox/all-mail reach and Gmail Trash. Bulk actions
remain one decision, with per-sender recovery. Counts and eligibility come from
the existing preview/status/Undo APIs; Protected exclusions remain unchanged.

Ownership: this session owns frontend accepted-action feedback and its tests.
The integration owner is this session. The branch is isolated; dependencies are
current main including #1066. No worker, API, policy, quota or billing changes.

Preview/loading/refusal and uncertain submission retain local feedback, because
there may be no accepted job. After acceptance, the shared tray owns progress,
slow/read-unknown, terminal result and Undo availability across navigation.
Local row locks, receipts and reconciliation remain in place. A failed read must
not claim failure or unlock mail that may still be moving. Completion counts
confirmed emails; bulk progress must identify its units and target. Partial
success must retain its warning alongside available Undo. Undo must visibly
cover request, restore polling and reconciliation; failures restore recovery.

Use synthetic data for destructive, partial, offline and failure states. No new
real mailbox changes. Onboarding, billing, provider behavior, action destinations,
retention and preview policy are excluded. Existing preview/no-op/quota,
protection, cancellation, repeated-click and mailbox guards must remain intact.

## Findings and verification

Initial source hypotheses: duplicate accepted-action toasts on Triage/Home
and overdue toasts on Senders/detail; bulk progress hides the sender and has
ambiguous units; Undo hides its decision during restoration without replacement
progress. Reproduce at the actual screen/tray seams before repairing.

## Implemented findings

| Finding                                    | Before                                                                                                                    | After                                                                                                                                    | Evidence                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P2 competing accepted-action feedback      | Triage/Home emitted terminal/read-error toasts; Senders/detail/Home/Triage emitted overdue toasts beside the tray         | Tray owns accepted progress, slow/unknown and terminal feedback; local locks, reconciliation and static receipts remain                  | Real screen integration tests, global tray/API seam tests   |
| P2 lost feedback during discovery failures | First failed active-list read had no cached group; a late empty list could miss the accepted result                       | Scoped transient handles survive navigation and resolve omitted jobs by their batch status; failed reads keep unknown feedback and retry | Held first response and aged-out empty-recovery regressions |
| P2 hidden Undo progress                    | Decision vanished while restore request/poll ran                                                                          | Visible Undoing line through request and polling, then Refreshing while reconciliation completes; terminal result remains authoritative  | Real Undo hook/tray tests and synthetic browser             |
| P2 bulk context and partial recovery       | A fraction hid the sender; unlabeled job fractions could look like email counts; partial warning sat above available Undo | Target stays visible; senders only when one job per sender, otherwise steps; partial warning attaches to its Undo                        | Pure contracts, shared rendering tests, browser             |
| P2 duplicate live announcements            | Expanded tray and Home receipt competed with tray announcer                                                               | Shared progress/info use one tray announcer; inline Home receipt remains readable without a second live announcement                     | Shared render regression, structural review                 |

Unknown progress consistently uses attention styling and View Activity, without
claiming the operation failed. Zero-change and Protected skips retain their
specific wording. Archive/Later/Delete destinations, scopes, timing and Undo
windows remain distinct. Refused/uncertain submissions and Keep retain local
feedback because there may be no accepted job to track. Standalone unsubscribe
receipts keep their independent delivery semantics.

## State coverage and limits

Existing live-preview/loading/zero/protected/cancel/keyboard/repeated-click tests
remain green for single and bulk sheets. Screen tests cover accepted progress,
late completion, failed/unknown holds, partial results, scoped reset and row
reconciliation. Tray tests cover fast completion, reload/navigation discovery,
mailbox switching, unknown reads, zero change, skipped senders, partial recovery,
expired/refused Undo, complete reverse sets, per-sender Undo and refresh latches.

No new plan, quota, API or provider policy was introduced. Billing and onboarding
remain excluded. No additional production mailbox mutation was performed. These
checks establish frontend feedback behavior against synthetic server responses;
they do not establish a new Gmail provider outcome.

## Verification

- Initial red regressions reproduced missing Undo progress and ambiguous bulk
  feedback against the prior code.
- Ten initial affected web suites: 706 tests passed, including real screen/API wiring,
  action previews and the shared global tray. One timing-sensitive existing
  external-Undo test was made deterministic by holding reverse status until the
  pending-state assertion completes.
- Two further Home/pill suites: 33 passed after full CI exposed three old
  assertions. Bulk progress now expects the visible sender; Home waits for
  reconciliation to release its progress line inside the existing 1.2-second
  deadline. No completion assertion was removed.
- Full shared suite: 921 tests passed after the final announcement regression.
- Production Next build and all 51 route bundle budgets passed. Root lint passed
  with six existing unused-disable warnings; root typecheck passed.
- Built-in browser: actual ProductUndoTray in an isolated production-mode bundle
  with synthetic endpoints. Checked bulk Archive running/slow, bulk Delete
  partial + Undo, single Later running/unknown, restore completion, and 320px
  layout bounds (no horizontal overflow). No real credentials or mail used.
- Independent reviewer found and verified fixes for mailbox scoping, local-state
  ownership, discovery races and duplicate announcements. Final review, including
  the attention-style adjustment and announcement regression, has no actionable
  findings. Focused final in-flight suite: 65 tests passed.

## Deferred opportunities

1. More precise per-sender outcomes for mixed composites: current aggregate job
   counts cannot establish how many distinct senders fully completed. Keep
   steps/qualitative partial wording until the API supplies that result. This
   would need a separate server contract change.
2. Durable unresolved-action reminders beyond a closed/reloaded session: current
   accepted handles are transient; Activity remains the durable recovery surface.
   No local persistence or new notification channel was added.

Integration state: local candidate; PR/CI/queue/deployment recorded separately.
