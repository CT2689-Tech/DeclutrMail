## 2026-09-28 — A new outbox consumer publishes to BullMQ inside the dispatcher's open claim transaction
**PR:** #807 (https://github.com/CT2689-Tech/DeclutrMail/pull/807)
**Caught by:** architecture-guardian (WARNING, then escalated to BLOCKING
+ CONFIRMED by both refuters on the next gate run), silent-failure-hunter
(WARNING + INFO on both runs)
**What happened:** `handleNonMailPurged`'s `rescoreSenders` calls
`scoreQueue.addBulk` and, through the delta trigger, `applyQueue.add`,
both awaited inside the dispatcher's `FOR UPDATE SKIP LOCKED` claim
transaction (`OutboxDispatcherWorker`'s per-row savepoint wraps every
`this.deps.consumer(event)` call, for every topic). Both queues share a
Redis connection built with `maxRetriesPerRequest: null` and ioredis's
default offline queue, which — as `queue.ts` already documents at its own
call sites — buffers commands across an outage instead of rejecting them.
A Redis outage during this call would therefore hang the open claim
transaction indefinitely: no `consumer_failed`/`event_failed` fires, and
every later tick either coalesces onto the stuck one or is dropped by
info-level backpressure logging, so nothing distinguishes "quiet" from
"wedged."

This is CLAUDE.md §2.6's named class ("No network call, queue publish...
inside an open transaction"), and the exposure is not new to this PR: the
existing `enqueueAutopilotApply` path (`mailbox.sync_ready`,
`triage.score_run_completed`) already runs the same way, inside the same
transaction, on the same connection. #807 adds two more awaits to an
already-shared pattern; it does not introduce the pattern.
**Correct approach:** Either the dispatcher's claim transaction should
commit its row bookkeeping before invoking the consumer (a different
at-least-once mechanism than today's rollback-on-throw), or every
network call a consumer makes should run outside any open transaction —
which the router's `db` handle already fails to guarantee, since
`buildOutboxConsumer(db, ...)` is wired once at the composition root with
the plain pool, not the dispatcher's savepoint (a separate, narrower
correctness gap: this handler's own `followupTracker` UPDATE commits
independently of whether `rescore` later throws — see the "Purge summary
log reports 0 reopened follow-ups after a retry" finding, fixed in the
same PR by splitting the log instead of relying on one transaction).
**Rule:** A consumer registered on `outbox-consumer-router.ts` must not
make a network call, and CLAUDE.md §2.6 must not be treated as satisfied
by "this file already does it elsewhere."
**Enforcement update:** A first gate run rated this WARNING and #807
documented-and-deferred it; a second run on the same diff re-scored it
BLOCKING, confirmed it by both refuters, and named the founder as the
only one who may waive a §2 rule; a third run confirmed it again after
the mitigation below landed. Documenting a §2 violation is not the same
as fixing it, and the gate correctly did not treat either as one.

#807 now bounds each of the two calls (`packages/workers/src/
rescore-senders.ts`, `withPublishTimeout`, 5s) so a hung Redis fails one
call within a known time instead of hanging it forever with no failure
signal at all — using only files #807 already owns. This is smaller than
it first sounds: the dispatcher claims up to 32 rows per tick in ONE
transaction and reports failures only after that transaction resolves,
so several purge rows in one batch, each hitting the bound, can still
hold the transaction for several times 5s, and the whole batch's failure
report waits for that. It also does not close the letter of §2.6 at all
— the network call still executes while the transaction is open, for
however long it runs. Moving it out entirely means redesigning the
dispatcher's claim/commit boundary across every registered consumer
(~8 topics, including the pre-existing `enqueueAutopilotApply`), which is
still out of scope for a small consumer-registration PR. Tracked as:
- its own task, spawned 2026-09-28 (`task_10d49b5e`), for the redesign;
- `docs/log/founder-followups/2026-09-28-waive-or-block-outbox-queue-in-transaction.md`,
  for the founder's merge-or-hold decision the gate's own words require.
