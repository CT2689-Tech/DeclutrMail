# Recovery follow-up: expired cursors and completion totals

Owner and integration owner: this chat, isolated a4ca worktree, branch
`codex/scan-recovery-edge-cases`, based on main `ec866c06`. No dependency PR.
Own initial/incremental workers and regressions, the API expired-cursor completion
argument, and the synthetic recovery driver. The only open PR at discovery was
dependency update #931; no overlapping source ownership. Relates to D8 and D224.

## Production observation and boundary

Read-only state at 2026-10-11 02:20 UTC confirms the legacy mailbox is ready at
100%, with cleared retry/error state and a successful sync at 02:14 UTC. Its
initial recovery succeeded at 2026-10-10 22:55 UTC. A second successful scan used
only 350 provider calls despite listing roughly 98,000 IDs, consistent with saved
row reuse. Its precise trigger was not established. Historical reported counts
versus later database counts do not establish data loss.

The remaining failed mailbox has `InvalidGrantError`, zero stored messages and no
automatic retry scheduled. The user excludes reconnecting this outside account.
No production account/auth/provider mutations, reset, migration or contact were
performed. Existing local Cloud reads failed authentication; the WIF fallback
provided the scoped serving snapshot. The earlier PR #927 rollout smoke failure
and subsequent successful descendant release remain recorded in its original
audit; this follow-up does not recast that failure as fixed.

## Findings and repairs

1. **Expired cursor handoff.** A queued job can carry cursor `1000` while the
   worker requests history from stored or restarted cursor `2000`. Forwarding
   `1000` makes the recovery comparison reject the reset, leaving the mailbox
   ready with expired history. Both 404 exits now return the rejected cursor;
   the discriminated result requires it for an expired outcome, and the API
   forwards it to the existing exact-cursor CAS. Advancement to `3000` still
   prevents an old completion from clearing the cursor.
2. **Completion total.** Gmail enumeration includes drafts, chats, invalid
   senders and vanished messages that are not persisted. Subtracting only
   unreadable metadata overstates completion. The worker counts this mailbox's
   persisted rows after rebuild/legacy cleanup, and uses one value for its
   result, `sync_runs` and `mailbox.sync_ready`. Read progress still counts
   processed IDs; API-call and duration metrics retain final-attempt semantics.

No schema, API envelope, privacy, permissions, billing or recovery-policy change.
Historical run records are preserved; corrected totals apply to future scans.

## Verification

| Scenario                                           | Observed result                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Negative control on original source                | Six regression failures and one existing matching case passed: actual rejected cursor missing, legacy draft total 5 versus 4 stored, draft/chat total 6 versus 1, resumed invalid/vanished total 5 versus 3 |
| Initial and incremental real-worker/PGlite suites  | 141 passed, including both 404 paths, later cursor advancement, legacy purge, exclusions, resume and result/history/event totals                                                                            |
| API sync suites                                    | 91 passed                                                                                                                                                                                                   |
| Queue and recovery policy suites                   | 33 passed                                                                                                                                                                                                   |
| Workspace typecheck; API recheck after driver edit | Passed                                                                                                                                                                                                      |
| Full lint; final changed-file lint and formatting  | Passed; existing unused-disable warnings retained                                                                                                                                                           |
| Real PostgreSQL/Redis/BullMQ terminal failure      | Five ordinary attempts; ten rows saved, original snapshot `1000`, durable automatic retry                                                                                                                   |
| Scheduled resume                                   | One metadata fetch, eleven stored rows, ready, original snapshot retained; run/event/result totals agree                                                                                                    |
| Completed reconnect                                | One history request/metadata fetch, zero full lists, twelve rows, ready, applied cursor `2000`                                                                                                              |
| Expired stale-payload fallback                     | Payload `1000`, stored/requested/rejected `2000`; recovery queues fresh snapshot and reaches ready at `3000`; fifteen listed IDs, eleven stored rows, consistent completion totals                          |
| Built-in browser on isolated synthetic API/web     | Saved-progress waiting survives reload; ready opens normal setup; Skip returns to Senders; final reload shows the expected synthetic identity and eleven emails; no browser error logs                      |
| Independent final review                           | Architecture/type-contract/privacy and adversarial recovery review clear, no actionable findings                                                                                                            |
| Live merge-queue policy audit                      | Repository-required producers match protection; external Vercel requires actual queue evidence                                                                                                              |

The disposable stack uses PostgreSQL port 5410, Redis port 6410/database 12 and
isolated API/web source copies without local credential files. Actual worker
lifecycle emits `worker.succeeded`; PostgreSQL verifies the driver parity of the
count and cursor queries. Gmail/OAuth responses are scripted; the long retry clock
is accelerated. The live account reconnect is explicitly excluded. The production
composition root's argument handoff is source-reviewed; the synthetic driver
passes the serialized worker result through the same recovery helper.

Screenshot evidence is stored outside the repository in this chat's visualization
directory as `scan-edge-recovered.png`, containing only synthetic data. Required
remote PR/queue/post-merge CI supplies the normal production build and browser
suites; merge and release states are reported separately.

Both concrete findings are implemented. No speculative feature expansion or
additional product decision is needed for this bounded repair.
