import type { Queue } from 'bullmq';

import { AUTOPILOT_APPLY_JOB, type AutopilotApplyJobData } from './autopilot-apply.worker.js';

/**
 * Debounce window for sync-delta-triggered Autopilot apply sweeps
 * (D100 "on new message arrival"). Five minutes balances the D100
 * real-time intent against burst collapse: a webhook storm (one
 * Pub/Sub push per message of a newsletter blast) becomes AT MOST one
 * sweep per window instead of one per delta, and the trailing-edge
 * scheduling below guarantees the window's LAST delta is still swept.
 * Well under option a's 15-30 min cron fallback from the founder
 * matrix (2026-07-07 P0 audit).
 */
export const AUTOPILOT_APPLY_DELTA_WINDOW_MS = 5 * 60_000;

/**
 * Producer for the `autopilot-apply` queue fired from the incremental
 * sync delta (2026-07-07 P0: apply sweeps fired only on
 * `mailbox.sync_ready` + `triage.score_run_completed`, and score runs
 * only fire for FIRST-SEEN senders — so new mail from a known sender
 * never re-triggered an enabled rule; an Active rule swept once at
 * sync then went dormant. This is the D100 "on new message arrival"
 * trigger the chain was missing).
 *
 * Debounce semantics (trailing edge):
 *   - `jobId = ${mailbox}-delta-${windowEndMs}` — every delta inside
 *     the same window computes the SAME id, so BullMQ dedups the burst
 *     into one job (`-`-separated: BullMQ rejects ':' in custom ids).
 *     `-delta-` namespaces away from the outbox consumer's
 *     `${mailbox}-${triggeredAtMs}` ids (a collision would be benign —
 *     both are full-mailbox sweeps — but distinct ids keep Redis
 *     debuggable).
 *   - `delay` schedules the sweep AT the window end, so the sweep runs
 *     after every delta of its window has landed. A leading-edge
 *     (immediate) sweep would miss any delta that arrives later in an
 *     already-swept window — the P0 in miniature. A delta landing in
 *     the promotion gap between "window end" and "sweep's DB read" can
 *     still slip a window, which is accepted: the next delta (or
 *     sync_ready / score-run trigger) sweeps it.
 *
 * Options mirror the outbox consumer's `enqueueAutopilotApply` (the
 * apply queue's other producer): no retry override — the sweep is
 * DB-only and the next trigger is the safety net.
 *
 * The composition root wires the returned fn into
 * `IncrementalSyncDeps.onDeltaProcessed`; tests pass a fake queue +
 * clock.
 */
export function buildAutopilotApplyDeltaTrigger(
  applyQueue: Pick<Queue<AutopilotApplyJobData>, 'add'>,
  opts: { windowMs?: number; now?: () => Date } = {},
): (mailboxAccountId: string) => Promise<void> {
  const windowMs = opts.windowMs ?? AUTOPILOT_APPLY_DELTA_WINDOW_MS;
  const now = opts.now ?? (() => new Date());
  return async (mailboxAccountId: string): Promise<void> => {
    const nowMs = now().getTime();
    const windowEndMs = (Math.floor(nowMs / windowMs) + 1) * windowMs;
    await applyQueue.add(
      AUTOPILOT_APPLY_JOB,
      { mailboxAccountId, triggeredAtMs: windowEndMs },
      {
        jobId: `${mailboxAccountId}-delta-${windowEndMs}`,
        delay: windowEndMs - nowMs,
        removeOnComplete: { age: 86_400 },
        removeOnFail: false,
      },
    );
  };
}
