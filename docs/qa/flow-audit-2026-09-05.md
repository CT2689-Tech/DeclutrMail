# Flow audit — 2026-09-05

Code inspection and failure-path fixes on `main`, starting at `924f06b2`.
These are local changes, not deployed fixes. Earlier uncommitted work remains in
the named `pre-existing changes before proactive bug sweep 2026-09-05` stash.

## Findings and changes

| User flow / trigger                                                 | Failure mechanism found in code                                                                                                                                                                            | Change                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screener: open Delete, focus Cancel or a scope option, press Enter  | The window key handler submits the pending decision before the focused control performs its own action. The previous chip test explicitly expected submission.                                             | Native buttons, links, and radio controls keep Enter; the global shortcut respects an already-handled event. Regression tests use actual keyboard activation on Cancel and a scope chip.                                                                                  |
| An expired access token during a temporary refresh outage           | The client converts every unsuccessful refresh, including 429/503 and network errors, to `false`, then navigates to Google sign-in.                                                                        | Only refresh 401 means the session was rejected. Other failures propagate without redirecting; the single-flight refresh latch releases so a later retry can succeed. The file-export recovery helper shares this behavior.                                               |
| Refresh rotation encounters a database outage                       | The API catches all rotation errors, clears all session cookies, and returns 401. A temporary outage destroys the browser's otherwise usable refresh credential.                                           | Missing/revoked sessions, reuse detection, and missing users throw an explicit unauthorized error. Other rotation failures return 503 without clearing cookies. Rotation locking, reuse revocation, and the existing grace window remain intact.                          |
| Switch accounts while an action POST or worker is still running     | Mutation calls and subsequent polls resolve the mutable active account. A delayed result can install an old action handle after the account has changed, and polling it under the new account returns 404. | Triage, Screener, Senders, and Sender Detail carry the origin account through enqueues, follow-on archive requests, status handles, parked jobs, bulk jobs, and undo polling. The shared batch hook now accepts the same explicit mailbox scope as single-action polling. |
| Switch accounts with an open preview or pending unsubscribe handoff | Query invalidation does not clear component-local previews, selections, and receipts. A late result can also populate old-account UI after the switch.                                                     | Account switches discard pending local state. Mailto handoffs and action receipts carry an account and render only in that account. Old-account Triage completion does not update the new account's progress or dismiss its batches.                                      |
| Export returns 401 again after one successful refresh               | The raw-file download path skips all unauthorized recovery when `isRetry` is true, leaving the user with a generic export error.                                                                           | A second 401 redirects to sign-in without attempting another rotation. A dedicated regression verifies exactly two export reads and one refresh.                                                                                                                          |

## Inspection beyond the changed paths

- Followed Screener decisions into `ScreenerService` and the composite action
  pipeline. Nonempty label actions already leave quarantine pending until the
  worker's success event; enqueue success alone does not resolve the sender.
- Read composite enqueue persistence and queue-error handling, including the
  existing transaction and `allSettled` behavior for sibling jobs.
- Read Later wake timer-version checks, mailbox locking, local-label restoration,
  and failure persistence. No worker behavior was changed in this pass.
- Checked session rotation's transaction, one-generation grace comparison, and
  committed reuse-revocation path before changing error classification.
- Examined Brief's separate scope-moved recovery path. It already suppresses the
  wrong-account failure report; its behavior was not changed in this pass.

## Verification

The keyboard, transient-refresh, rotation-outage, Screener switch, and export
replay regressions were observed failing before their corresponding fixes.
Delayed Triage responses and bulk status headers also have regression coverage.
The checks validate these mechanisms; they are not evidence that every possible
production flow has been audited. No live Gmail, billing, or production data was
modified.

## Sync and recovery follow-up

This pass traced the current source from onboarding controls through sync API
writes, queue scheduling, reconciliation, and worker outcomes. Historical
launch ledgers were not used to decide what was broken.

| Trigger                                                           | Confirmed defect                                                                                                        | Fix                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Two tabs retry a failed initial scan                              | Both read `failed` before either writes; both reset the cursor and schedule work.                                       | One conditional database update claims `failed → queued`; only its winner schedules.                                        |
| Disconnected or deletion-paused mailboxes have queued sync intent | They consume the bounded reconciler batch repeatedly although workers cannot process them, delaying eligible mailboxes. | Apply the existing worker eligibility predicate before the batch limit. Paused intent remains available after cancellation. |
| Leave a targeted reconnect scan before completion                 | The escape button navigates to the same success result as a completed scan.                                             | Early exit returns to Settings without claiming success; failed account switches show a retryable error.                    |
| Switch mailboxes while “Sync now” is checking or watching         | A late preflight can enqueue after leaving; the next mailbox's timestamp can be mistaken for completion.                | Reset the watch per mailbox, stop preflight on unmount, and explicitly scope sync requests to the displayed mailbox.        |
| Fresh preflight status fails or discovers an unfinished scan      | The button queues incremental work anyway using its cached snapshot.                                                    | Require a successful, ready status read before queueing; failed reads leave a visible retry message.                        |
| A failed sync recovers between two status polls                   | Any new error timestamp wins even when a newer successful sync is present.                                              | Compare outcome timestamps and report the newer success.                                                                    |

The retry race, recovery-batch starvation, early-exit result, and four Sync-now
regressions were observed failing before their fixes. The backend sync checks
passed (34), worker sync/queue checks passed (128), and focused frontend checks
passed (77). API and web typechecks, lint for changed source files, and
`git diff --check` passed after final cleanup.

### Browser smoke evidence

Verified the Next.js dev server served this `main` checkout on port 3117.
Existing servers on 3000 and 3109 belonged to other worktrees; their results
were excluded. The home page loaded and its interactive elements rendered
without reported browser errors.

- `docs/eval/sync-recovery-smoke.cjs`: four passing mobile cases covering
  failed status reads, manual and automatic recovery, permission recovery,
  and the secondary-account escape control.
- `docs/eval/initial-sync-flow-smoke.cjs`: ten passing cases at 390px and
  1280px covering failed scan → retry → progress → first review, retry 429,
  mailbox-bound OAuth navigation, early reconnect exit, and failed account
  switching. The early-exit case asserts the requested destination, not the
  contents of the Settings page.
- Screenshots: `/tmp/declutrmail-sync-smoke/` and
  `/tmp/declutrmail-initial-sync-smoke/`.

Both browser harnesses exercise the real UI with controlled HTTP responses.
They do not establish that live Gmail OAuth, Gmail writes, or production
infrastructure work. No production data, credentials, billing, or email delivery
was changed. The retry and reconciler database regressions use an isolated
PGlite database; they are not a production PostgreSQL concurrency/load test.

## Final launch smoke and landing-page pass

Used the current main checkout with a separate local API, Redis, and PostgreSQL
smoke database, applying all 78 migrations and synthetic mailbox fixtures. No
production credentials, Gmail action worker, or payment provider was used.

The real backend exposed one additional bug: when billing is disabled, the
streamed invoice gate remounts a failed subscription observer. Its automatic
retry puts the parent back into loading, unmounting the gate, and repeats. A
browser run produced thousands of failed reads. The subscription query now
sets `retryOnMount: false`, preserving explicit refetch and invalidation. A
regression using the actual invoice gate failed before the fix and passes after
it; all 208 billing tests pass.

Verification after the fix:

- 30 signed-in route/viewport checks pass across 15 screens at desktop and phone
  widths, including billing, sender detail, automation, Activity, and Settings.
- 14 real-API interaction scenarios pass: search/clear, empty-filter recovery,
  Archive/Later/Delete preview cancellation, desktop table/grid switching,
  mobile navigation, and data export. Cancellation sends no cleanup mutation.
- 44 public accessibility and hydration checks passed before landing edits.
- Reusable local-only scripts: `docs/eval/product-launch-smoke.cjs` and
  `docs/eval/product-interactions-smoke.cjs`. They require the synthetic billing
  seed and an authenticated local API; they deliberately reject remote URLs.

The landing page now leads with sender-based cleanup, puts free signup and the
no-sign-in demo side by side, explains the free allowance and undo beside the
CTA, visibly labels its example, and ends with a concrete first step. Mobile
CTAs span the available width. Pricing limits and undo use the existing shared
constants; OAuth permissions and shared privacy disclosures remain intact.

This completes the local code and smoke pass, not a production certification.
Live Gmail and billing rehearsals were already completed on founder-owned
accounts, reconfirmed by the founder on 2026-09-05. They were not repeated in
this local pass; that is a scope limit, not an outstanding rehearsal blocker.
The billing completion is also recorded in `FOUNDER-FOLLOWUPS.md` on
2026-09-01, and `docs/qa/launch-qa.md` records real Gmail sync verification.
Direct Paddle transaction re-verification on 2026-09-05 was blocked by its
browser login screen; no fresh provider-state verification is claimed.

Final landing verification: all 44 public accessibility/hydration checks pass
again after the edits. Desktop and phone browser checks also pass for both
signup destinations, permission disclosure, demo pause/resume, simulator
navigation, and absence of horizontal overflow. Screenshots were inspected at
both widths. Web typecheck, lint for this pass's changed source, and
`git diff --check` pass. Changes remain local and uncommitted on `main`.
