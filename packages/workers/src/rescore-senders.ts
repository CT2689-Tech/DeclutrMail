import type { Queue } from 'bullmq';

import { SCORE_JOB, scoreJobId, scoreJobOptions, type ScoreJobData } from './score.worker.js';

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
 * and is not this file's job. This bounds each of the two calls instead:
 * a hung Redis now fails one call within `PUBLISH_TIMEOUT_MS` rather than
 * hanging it forever with no failure signal at all. It does NOT bound the
 * transaction as a whole — the dispatcher claims up to 32 rows per tick
 * in one transaction and reports failures only after that transaction
 * resolves (`OutboxDispatcherWorker.runOneTick`), so several purge rows
 * in one batch, each hitting this bound, can still hold the transaction
 * for several times `PUBLISH_TIMEOUT_MS`, and the whole batch's failure
 * report waits for that. It does not cancel the underlying command —
 * ioredis has no cancellation for one already queued — so a very late
 * resolution after the timeout is simply ignored here; BullMQ's jobId
 * dedup makes a subsequent retry's re-publish safe either way.
 */
const PUBLISH_TIMEOUT_MS = 5_000;

function withPublishTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`rescoreSenders: ${label} exceeded ${PUBLISH_TIMEOUT_MS}ms`)),
      PUBLISH_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
    await withPublishTimeout(
      deps.scoreQueue.addBulk(
        senderKeys.map((senderKey) => {
          const data: ScoreJobData = {
            mailboxAccountId,
            senderKey,
            trigger: 'signal_change',
            producedAtMs,
          };
          return { name: SCORE_JOB, data, opts: scoreJobOptions(scoreJobId(data)) };
        }),
      ),
      'score queue addBulk',
    );
    await withPublishTimeout(deps.sweepAfter(mailboxAccountId), 'autopilot sweep trigger');
  };
}
