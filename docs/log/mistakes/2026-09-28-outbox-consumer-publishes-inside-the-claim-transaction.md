## 2026-09-28 — A new outbox consumer publishes to BullMQ inside the dispatcher's open claim transaction
**PR:** #807 (https://github.com/CT2689-Tech/DeclutrMail/pull/807)
**Caught by:** architecture-guardian (WARNING), silent-failure-hunter (WARNING + INFO)
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
**Enforcement update:** None in #807 — fixing it means redesigning the
dispatcher's transaction/commit boundary across every registered
consumer (~8 topics), which is a separate, larger piece of work, not a
fix that belongs inside a small consumer-registration PR. Flagged to the
orchestrator for a `defect-class-sweeper` pass over
`outbox-consumer-router.ts` before the count of consumers with this
shape grows further.
