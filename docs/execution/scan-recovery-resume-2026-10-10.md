# Terminal scan recovery and reconnect continuity

## Flow contract

Owner and integration owner: this chat, isolated a4ca worktree and
`codex/scan-recovery-resume`, based on main `c6f3e0ad`. No dependency PR.
Own sync service/reconciler, initial-sync worker, sync-state metadata and
contracts, recovery UI and focused tests. PR #925 owns billing/outbox notices;
keep composition-root edits limited to extracting the existing expired-cursor handler, away from billing/email wiring.

Completed mailbox reconnect: fresh credentials → preserve ready state and applied
history cursor → incremental catch-up → persisted new cursor. An expired Gmail
history cursor retains the existing full-resync fallback. First/partial scans keep
their original snapshot and saved message rows; retries fetch only missing data.

Terminal initial-scan recovery: exhaust the ordinary job retries → persist the
failure and next eligible retry → wait → atomically claim one bounded automatic
recovery → resume saved work → ready, or a classified failure with manual recovery.
Use up to three automatic recoveries, spaced 15/30/60 minutes, and honor a longer
provider Retry-After. Invalid grants, insufficient permissions and permanent or
unknown failures do not automatically retry. Existing failed rows are eligible
after the same cooldown. Disconnect and pending deletion exclude scheduling and
worker entry. Queue outages leave durable intent for the existing reconciler.

| State / transition                                 | User sees                          | Persistence and queue consequence               | Verification |
| -------------------------------------------------- | ---------------------------------- | ----------------------------------------------- | ------------ |
| Recoverable terminal failure                       | Saved progress and scheduled retry | Error retained; durable deadline and budget     | Pending      |
| Deadline not reached                               | Waiting; refresh retains deadline  | No early Gmail call                             | Pending      |
| Due, repeated tick / concurrent claimant           | Scan resumes                       | One atomic claim and one mailbox job            | Pending      |
| Resume partial scan                                | Saved progress, then ready         | Original snapshot; stored messages skipped      | Pending      |
| Recovery budget exhausted                          | Failure and manual recovery        | Automatic attempts stop                         | Pending      |
| Invalid grant / permission / permanent failure     | Reconnect or manual help           | No automatic retry                              | Pending      |
| Ready reconnect, including previously disconnected | Existing app remains usable        | Cursor retained; incremental catch-up           | Pending      |
| Expired history cursor                             | Existing resync recovery           | Fresh snapshot only when history is unavailable | Pending      |
| Late old failure after reconnect / completion      | Fresh intent or ready state        | Old failure cannot overwrite new state          | Pending      |
| Inactive / deletion-pending mailbox                | Existing inactive/paused state     | No provider work; no recovery claim             | Pending      |

Verification uses synthetic accounts, real disposable PostgreSQL/Redis and the
built-in browser. Provider adapters are deterministic stubs for failure, saved
progress and expired-history cases. Production checks are scoped reads and normal
release verification; no manual reset, credential change or broad mailbox mutation.
The requested merge uses normal checks and queue protection.

## Baseline observations

The reconciler sweeps queued and stale-syncing rows, omitting failed rows.
`markConnected` requires an active, ready, healthy mailbox to preserve its cursor;
revoked/disconnected ready mailboxes pass through `markQueued`, which clears it.
InitialSync already skips stored message ids, preserving the original initial
snapshot across retries. It resets the displayed progress before checking saved
work. Recovery verification must test the complete provider → worker → DB → API
→ browser join, not just a queue acceptance or a changed status string.

Infrastructure read at 2026-10-10 20:53:52 UTC used the existing WIF fallback.
API `00574-loy` and worker `00149-lqw` each served 100%. Local reads failed with
`authentication_required`; that access failure is preserved.

## Implemented repairs and review

- Completed reconnects preserve ready state, applied history cursor and last-sync
  timestamp, including previously disconnected or revoked grants. Fresh credentials
  clear superseded authentication markers; catch-up runs after commit.
- Terminal transient/quota failures persist a 15/30/60-minute recovery deadline and
  three-attempt budget. The active/non-deletion sweep claims recovery atomically,
  keeps saved progress and the original snapshot, then schedules outside the write.
  A longer provider Retry-After also constrains manual retry after the budget ends.
- The gate reads durable automatic and manual deadlines; refresh retains its
  scheduled state. Unknown SSR time does not enable an early retry or invent a
  start time. Existing polling observes recovery and opens normal onboarding.
- Independent review identified a contradictory failure email and stale active
  callbacks after reconnect. Scheduled failures retain history while the manual
  failure notice waits until user action is required. A nullable per-attempt UUID
  fences stage, progress, snapshot, ready and terminal writes; post-claim writes
  cannot recreate deleted state. Unknown ownership records history only. The failure-history insert locks the latest
  indexed-data deletion request and skips a completed purge, preserving that boundary.
- Expired history retains full-resync fallback through an extracted helper. Its
  ready/cursor compare-and-update prevents old results from rewinding a newer cursor.

## Verification evidence

Negative controls: the two completed reconnect regressions returned `queued`
instead of `kept_ready` on the old implementation; the terminal transient sweep
made zero scheduling calls. Existing twenty-one cases passed in that failing run.

The isolated PostgreSQL/Redis driver ran the real BullMQ/Base worker lifecycle:
five ordinary failures saved ten messages and cursor `1000`; the scheduled recovery
fetched only one new message and became ready with the same cursor. Reconnect
performed one history request, one metadata request and zero full-message lists,
advancing to `2000`. Expired history invoked the production recovery helper and
completed with a new snapshot `3000`. Gmail/OAuth boundaries are deterministic
synthetic adapters; no live provider authorization was exercised. The long recovery
clock is accelerated through the reconciler's injectable clock.

The two API/browser journeys passed after correcting the expired-path test's Home
expectation to the app's existing first-backlog destination, Senders. Built-in browser
verification confirmed the synthetic account, refresh persistence, 390px layout,
and usable Senders after completion/reconnect. Screenshots are saved in the current
chat's visualization directory as `scan-recovery-mobile.png` and
`scan-recovery-complete.png`.

Final migration 0082 adds only nullable attempt UUID/deadline and a smallint counter
with constant zero default. PostgreSQL 14 populated apply/rollback/reapply preserved
failed state, 40% progress and cursor 123; the table's heap identity did not change.
Atlas validation and Drizzle check passed. Historical local builds ran out of disk
space; generated task caches were cleared. The final local production build uses an isolated source copy with persistent
compiler caching disabled to fit available disk space. Runtime source/configuration
is otherwise unchanged; normal cache-enabled build and budgets remain required in CI.

Latest completed focused checks: 91 API sync tests, 89 initial-worker/policy tests,
59 gate tests; incremental tests also passed earlier. Independent architecture/schema/design review is clear after the purge-boundary fix.
The full journey suite passed 20 tests with one disabled PostHog opt-in case skipped;
the scheduled recovery Axe scan reported zero violations. Build/budgets and remote
checks are pending.
