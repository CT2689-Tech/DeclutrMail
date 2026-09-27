import type { Queue } from 'bullmq';

import { SCORE_JOB, scoreJobId, type ScoreJobData } from './score.worker.js';

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
