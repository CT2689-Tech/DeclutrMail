# Later must not create a Keep decision

## Contract and ownership

Follow-up to the Archive/Later Undo audit and #1064. An approved one-email production Later → Undo restored the exact original Gmail labels, Inbox/archived counts and buttons, and cleared its return timer. It exposed a separate source-confirmed defect: a sender with no prior policy row acquired the database default `keep` when the timer row was inserted; the sender list then said “Skipped in Triage”. The account and sender matched the approved target. Mail and its original unread state are restored; the test-created metadata row remains pending a narrowly approved cleanup.

Later is a timed current-mail action (D245), not a standing Keep choice. A timer-only policy row must represent no standing verdict. New Later and return-time writes must preserve existing Keep, Unsubscribe and protection state; Undo must clear only its matching safe timer and leave genuine standing choices intact. Explicit Keep after a neutral timer row must record a real decision. List/detail, Inbox Report and exports must receive the same neutral facts. Existing ambiguous historical Keep rows must not be reclassified from missing audit history.

Integration owner: this task. Isolated worktree reused at current main `68289bbc5`, branch `codex/later-undo-neutral-policy`. Own the nullable standing-verdict schema/migration, two timer writers and focused provider/read/Keep regressions. No billing, OAuth, retention, Undo-window, provider-label or unrelated protection behavior change. Independent reviewer covers existing readers, architecture/privacy/schema gates and final diff.

## Proposed bounded repair

Permit a null standing verdict in `sender_policies.policy_type`; keep the existing default for unrelated legacy writers, and make both timer-only inserts explicitly write null. Conflict updates remain timer-only. Existing rows and genuine standing decisions are unchanged. The existing nullable API/UI contracts and comparison readers then represent these rows accurately. No bulk historical backfill.

Making neutral timer rows explicit also exposed an adjacent Undo defect: Undo Keep deleted the whole policy row, including an independent Later timer or recovery note, and a delayed Triage Keep projection could reinsert Keep after Undo. Undo now clears only the standing verdict and reverts pending Keep history even if projection has not landed. Undo and projection take the existing mailbox advisory transaction lock before reading policy/audit state, with a ten-second local lock timeout. A newer explicit Keep after Undo still projects; protected and non-Keep decisions retain their existing guards.

This includes a production schema migration. Local preparation and review may proceed, but merging/applying requires founder approval under `CLAUDE.md` §2 and §9. Any cleanup targets only the exact metadata row created by the approved production test, after verifying its original absence, creation/update timestamps, no newer user decision, cleared timer and unchanged flags. No further production mail action is authorized by this document.

## Verification

### Regression evidence

- The no-prior-policy Later lifecycle and direct timer insert assertions fail against the old writers (Keep instead of null). Forward Later and actual worker Undo now retain null, Keep or accepted Unsubscribe as appropriate, restore the original labels and clear the timer. Existing Keep/Unsubscribe choices survive rescheduling.
- Real sender list/detail reads expose null for timer-only metadata. The real Inbox Report fix-set keeps a neutral sender eligible and excludes it only after explicit Keep. Explicit Keep after a neutral row writes one audit; retry is a no-op.
- Keep → Undo retains an active timer, note and recovery state. Missing policy and neutral timer rows still revert pending Keep activity. The second Undo is a no-op.
- Two deterministic real-Postgres cases pause the actual Keep upsert after its audit read, then interleave Undo, with and without an existing neutral timer row. Both fail with the previous row-lock-only implementation and pass with the shared advisory lock. A later explicit Keep remains projectable.
- Workers: 144 tests pass across label-action, Autopilot-action and snooze-wake. API: 288 pass across six affected suites (11 existing driver-specific skips); outbox suite separately confirms all 26 cases pass. Real Postgres: 12 pass, including the two new races. Database: 115 tests pass across 31 suites.
- Workspace type checks pass. Lint has zero errors and six pre-existing unused-disable warnings. Formatting is checked separately after final documentation edits.

### Local runtime and schema smoke

Owned, loopback-only Postgres 16 and Redis instances back an isolated API/web stack. The running server checkout and ports were verified; no production provider client or worker runtime was started. The Mac native-loader cache needed the unchanged OS HOME in the isolated launcher; no application dotenv or credentials were copied.

The actual authenticated HTTP routes create a neutral timer, show null on detail, apply explicit Keep, Undo it, and preserve the original timer: responses 200/201 with the existing envelopes. The built-in browser confirms the list, inspector and full sender page show the restored counts and available actions without a fabricated Keep result. These synthetic HTTP checks do not claim a real Gmail mutation.

A disposable harness ran the real LabelActionWorker lifecycle against Postgres with a recording provider port. Both forward Later and reverse Undo emit `worker.succeeded`; one synthetic message restores its exact Inbox/unread labels, the timer clears and policy remains null. The temporary harness was removed before commit.

Migration 0095 was tested with the CI-pinned Atlas community v1.3.0: full migration history through 0094, dry-run/lint, apply, catalog read, rollback and reapply. Apply leaves the existing Keep/default unchanged, accepts a new null timer row, and reports the column nullable. Rollback fails closed while neutral rows exist; after removing only local synthetic neutral metadata, rollback restores NOT NULL and retains genuine Keep. No production schema has been changed by this audit.

### Release and restoration gates

#1064 is merged at `68289bbc563588f2014d5e275e83cb0c474becb8`, its full merge-queue CI passed, and the production Vercel alias/browser build identified that release before either live action interval. The approved one-email Archive → Undo and Later → Undo checks each restored the exact original Gmail labels, counts and controls without a manual reload or Scan. Later's timer was independently verified cleared. Background sync was active, so this does not claim restoration without sync.

Independent review covered architecture, privacy, schema compatibility, reader semantics and the real concurrency regression. No source blocker remains. The database expansion must land before API/worker writers: the normal Cloud Run release waits for successful migration apply at the exact main SHA. Do not use manual deployment to bypass that wait.

This follow-up remains a draft pending explicit production-migration approval. Once approved, verify migration success and nullable catalog state, deployed API/worker revisions and browser release before touching the test residue. Reset only the exact test-created policy's standing verdict to null with identity, timestamps, cleared timer, unchanged modifier/status/recovery and no-newer-Keep guards. Invalidate only that mailbox's derived Inbox Report cache if the guarded reset changes one row. Do not rewrite historical rows or delete the sender/email. If a guard changed, stop and re-read rather than broadening the cleanup.

Complete restoration of the test-created metadata remains open. A further one-email Later → Undo production verification requires its own explicit narrow approval; no new mail mutation is authorized by the code/audit document.

### Deferred boundaries

Old default Keep rows cannot safely be identified by missing Keep audit alone: an explicit Keep on an existing default row may historically have been an idempotent no-op. No bulk reclassification is attempted. Protection-only writers retain their prior default behavior; changing that separate product contract is outside this repair. No API envelope, Gmail scope, retention, billing, provider-label or Undo-window change is included.
