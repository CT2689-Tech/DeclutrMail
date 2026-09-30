import type { Queue } from 'bullmq';

import { SCORE_JOB, scoreJobId, type ScoreJobData } from './score.worker.js';

/**
 * `rescoreSenders` is called from inside the outbox dispatcher's open
 * claim transaction (`handleNonMailPurged`, per-row savepoint) — a
 * pre-existing pattern this file extends rather than introduces (the
 * sibling `enqueueAutopilotApply` consumer does the same). CLAUDE.md
 * §2.6 bans a queue publish inside an open transaction because the
 * queues' Redis connection (`maxRetriesPerRequest: null`, default
 * offline queue) BUFFERS commands during an outage instead of rejecting
 * them, so an unbounded await would hold the transaction's row locks and
 * pooled connection for as long as the outage lasts. Moving these calls
 * outside the transaction needs redesigning the dispatcher's claim/
 * commit boundary, which is tracked separately
 * (docs/log/mistakes/2026-09-28-outbox-consumer-publishes-inside-the-claim-transaction.md,
 * docs/log/founder-followups/2026-09-28-waive-or-block-outbox-queue-in-transaction.md)
 * and is not this file's job.
 *
 * The bound on `addBulk`/`sweepAfter` below is the dispatcher's OWN
 * `consumerTimeoutMs` (`OutboxDispatcherWorker.runConsumerWithOrphanGuard`) —
 * this file used to add its OWN, separate 5s `withPublishTimeout` on top,
 * reasoning that firing sooner was "strictly better." It was not: an
 * inner bound that can fire BEFORE the dispatcher's own settles THIS
 * function's returned promise early, which means `trackOrphan` receives
 * an ALREADY-SETTLED promise — its `.then(clear, clear)` clears the
 * orphan-guard entry on the very next microtask, while the real,
 * abandoned `addBulk` call keeps running for real, completely
 * untracked. The very next tick would then happily re-claim and
 * re-invoke this function for the SAME mailbox while the first call's
 * publish was still in flight — exactly the unguarded-concurrent-retry
 * shape the orphan guard exists to prevent (round-3 architecture-
 * guardian review, 2026-09-29; verified live). Removing the inner bound
 * removes the race entirely: `consumerTimeoutMs` is now the ONLY timer
 * in play for this consumer, so there is nothing left for it to race
 * against. Do not re-add a local timeout of ANY length here — shorter
 * than the dispatcher's own bound settles this function's promise
 * before `trackOrphan` ever sees it (the round-3 bug above); LONGER,
 * and the same clear-on-settle handler fires the moment that inner
 * timer eventually fires anyway, un-tracking a call that is still
 * running either way (round-4 architecture-guardian review, 2026-09-29,
 * live-probed with a 40ms inner timer against a 20ms dispatcher bound —
 * still broken, despite being longer, not shorter). See
 * `OutboxConsumer`'s own docstring in `outbox-dispatcher.worker.ts` for
 * the general rule; see `docs/log/founder-followups/
 * 2026-09-28-waive-or-block-outbox-queue-in-transaction.md`'s
 * "Correction 2026-09-29 (round 3)" for the full history of why this
 * looked safe twice before it wasn't.
 *
 * It does not cancel the underlying command on timeout — ioredis has no
 * cancellation for one already queued — so a very late resolution after
 * the dispatcher gives up is simply ignored; BullMQ's jobId dedup makes
 * a subsequent retry's re-publish safe either way.
 */

/**
 * Re-score a set of senders whose counts changed outside a score run —
 * today, the ones a `mailbox.non_mail_purged` event names.
 *
 * One `signal_change` job per sender, keyed by `scoreJobId` on the
 * caller's clock, so a redelivered event dedups. Every one of those runs
 * then publishes `triage.score_run_completed` with that same clock, so
 * the Autopilot sweeps they trigger collapse onto the first to finish —
 * which can start before the rest have written their verdicts. So this
 * also calls `sweepAfter` once, which the composition root points at a
 * trailing sweep late enough to read them.
 */
export function buildRescoreSenders(deps: {
  scoreQueue: Pick<Queue<ScoreJobData>, 'addBulk'>;
  sweepAfter: (mailboxAccountId: string) => Promise<void>;
}): (
  mailboxAccountId: string,
  senderKeys: readonly string[],
  producedAtMs: number,
) => Promise<void> {
  return async (mailboxAccountId, senderKeys, producedAtMs) => {
    if (senderKeys.length === 0) return;
    await deps.scoreQueue.addBulk(
      senderKeys.map((senderKey) => {
        const data: ScoreJobData = {
          mailboxAccountId,
          senderKey,
          trigger: 'signal_change',
          producedAtMs,
        };
        return { name: SCORE_JOB, data, opts: { jobId: scoreJobId(data) } };
      }),
    );
    await deps.sweepAfter(mailboxAccountId);
  };
}
