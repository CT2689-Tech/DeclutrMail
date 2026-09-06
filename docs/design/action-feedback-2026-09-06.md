# Action feedback — discussion draft, September 6, 2026

## Problem observed

The founder clicked Undo beside Abercrombie in Activity. Gmail restored mail,
but the interface gave no sustained progress feedback. Other senders changed to
UNDONE because the row used the same composite reversal route as batch receipts.

Confirmed in the prior implementation:

- `features/activity/api/use-activity.ts` settled the mutation after enqueue and
  invalidated Activity once; `lib/api/activity.ts` discarded the reverse handle.
- `UndoController` expanded every token through `enqueueCompositeRevert`, whose
  `composite_id` relation includes other senders in a bulk action.
- `features/senders/senders-screen.tsx` emits progress and terminal toasts and
  renders `ReceiptStrip` / `UnsubBatchReceipt`. `app-chrome-layout.tsx` also mounts
  `ProductUndoTray`. These overlapping feedback channels need one owner per action.
- Activity shows unsubscribe intent, provider acceptance, and optional historical
  mail movement as separate records. They are distinct facts, but presenting all
  as equal rows makes one user decision look like several unrelated actions.

## Immediate correction in this change

Activity uses `POST /api/undo/:token/action`, with the same authentication,
mailbox ownership, CSRF, expiry, and rate-limit checks. It reverses exactly the
forward action associated with the token. The existing route keeps composite
scope for existing receipt/tray callers. The new route fails closed against an
older API; an unrecognized query parameter could silently retain batch scope.

The Activity mutation waits for the reverse worker result. Shared pending state
keeps row buttons disabled across remounts and bulk selection. Completion and
failure refresh Activity, Senders, the Undo tray, and previews. Bulk completion
no longer clears the partial-failure feedback as though the filter had changed.
No additional
success toast is introduced.

| State / transition                        | Visible feedback                                                     | Cache effect                            | Verification                             |
| ----------------------------------------- | -------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| Click / enqueue pending                   | Undoing… beside that row                                             | None yet                                | Render test                              |
| Worker queued / executing                 | Same disabled Undoing…                                               | Poll originating mailbox                | API lifecycle tests                      |
| Worker confirms reversal                  | Undone                                                               | Reconcile Activity and action readers   | Render + integration tests               |
| Already reversed                          | Undone after refresh                                                 | Reconcile readers                       | Idempotent replay tests                  |
| Worker fails, possibly after partial work | Inline explanation and Try again                                     | Reconcile possible partial changes      | Failure test                             |
| Status unavailable / bounded wait ends    | Cannot confirm; may still finish; refresh to check                   | Reconcile readers                       | Access-loss and timeout tests            |
| Mailbox switches while polling            | Old job remains pinned to originating mailbox                        | Fresh reads use current scope           | Explicit mailbox-header tests            |
| Multi-select Undo                         | Only selected action tokens; selection stays busy through completion | Reconcile results, preserve failed rows | Shared scoped path; bulk render coverage |

## Proposed feedback model — not yet a product-wide implementation

One action has one primary visible feedback surface. Activity remains the durable
history; history is not an additional popup.

1. **Stay local while the context is visible.** A row action updates that row. A
   selected batch uses one selection bar with a count. A settings save updates
   the relevant form. A fast success changes the local state quietly.
2. **Hand off when the user leaves.** A compact global status summarizes ongoing
   work only when its local owner is not visible. Do not show both a global
   completion toast and a local receipt for the same operation.
3. **Update one message through the lifecycle.** Queued → working → complete,
   partial, failed, or unconfirmed. Enqueue acceptance is never completion.
   Deduplicate by mailbox plus action/batch identity, not by identical text.
4. **Reserve interruption for an actionable problem.** Reconnect, permissions,
   billing access, and terminal failures remain visible with a next step.
   Routine automatic retries stay in progress; they do not need repeated toasts.
5. **Group related Activity facts.** One expandable entry per user decision,
   retaining substeps such as “unsubscribe request accepted” and “384 emails
   moved to Trash.” Each Undo control names the reversible substep and its scope.
   A sent unsubscribe cannot be recalled. Partial outcomes remain explicit.
6. **Treat bulk outcomes as a summary.** “4 of 5 actions completed; 1 needs
   attention.” Expand for sender details. Avoid five completion toasts.
7. **Keep accessibility quiet but complete.** Polite status announcements for
   progress/results, no focus movement for routine completion, stable button
   placement, persistent actionable errors, and reduced-motion support.

## Operational alerts are a separate audience

The September 6 Cloud incident was four 45-second acquisition timeouts across
three jobs. Logs show all three succeeded on retry by 08:29:56 UTC. A sync with
1,516 label changes completed before the waiting jobs resumed. This supports
contention; it is not evidence of an unlock failure or a lasting lock leak.

Proposal: distinguish acquisition contention that recovers from terminal job
failure, sustained queue delay, and unlock/session-integrity failures. Preserve
raw logs. Group retries into one incident and send one recovery for an incident
that was actually escalated. Exact thresholds require observed workload data;
this change does not modify monitoring policies or suppress Sentry issues.

## Decisions to discuss

- Inline-first feedback with a global handoff is recommended over a permanent
  global notification stream.
- Should successful global statuses disappear after a short interval while errors
  persist, or stay in a user-opened activity drawer?
- Should the global Undo tray become that compact action status surface, so there
  is one place for both ongoing work and available reversals?

## Limits and follow-up

The local fix does not retroactively re-delete email restored by the earlier
batch Undo. It does not change unsubscribe delivery, worker label semantics,
undo windows, or notification settings. A full Gmail-backed production smoke
requires deployment; fixture browser checks and database-backed tests establish
only their stated layers.

Further review should examine composite receipt completion: existing callers poll
one reverse handle even when a batch expands into several jobs. That pre-existing
limitation needs aggregate completion semantics before a unified global status
can promise that an entire batch finished.

## Verification recorded

- 169 API integration tests passed across ActionsService, UndoService, and
  ActivityReadService; 90 frontend tests passed across Activity rendering,
  the scoped Undo polling client, and the existing action client.
- Negative controls reproduced extra reverse jobs for a row click, missing
  worker-status polling, and bulk completion erasing the failed-row affordance.
- Workspace typecheck passed; workspace lint had zero errors and seven existing
  unused-disable warnings. Changed files passed lint.
- The Storybook progress fixture rendered in the browser with Undoing disabled
  in the originating row. This is a fixture check, not a live Gmail mutation.
- Sentry readback at 18:46 UTC: DECLUTRMAIL-WEB-23 (issue 7714926302) had one
  lifetime event, last seen 07:02:34 UTC, release
  31f32cf858310ff19b9de4209721bf214f1e2027. The bounded diagnostic had no
  application frames. Cause and any relationship to Undo remain unverified.
