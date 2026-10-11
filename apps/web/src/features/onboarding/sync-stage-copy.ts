import type { SyncStatus, SyncStage } from '@declutrmail/shared/contracts';

/** Title while a scan is in progress. Home has no `ws2.home.syncing.title`. */
export const SYNC_READING_TITLE = 'Reading your Gmail\u2026';

/**
 * Reassurance when the ready email is not promised. Home uses this as the
 * syncing status until a status read names a real stage. There is no
 * `ws2.home.syncing.body`.
 */
export const SYNC_LEAVE_LINE = 'You can close this tab and come back later.';

export const SYNC_LEAVE_EMAIL_LINE =
  'You can close this tab \u2014 we\u2019ll email you when your inbox is ready.';

/**
 * ONE sentence per REAL backend stage (D224). Typed against the
 * contract's stage union, so a new worker stage is a compile error here
 * until it has a sentence — the gate can never show a label for work
 * the worker is not doing.
 */
export const STAGE_SENTENCE: Record<SyncStage, string> = {
  queued: 'Waiting to start.',
  fetching_metadata: 'Reading sender info.',
  building_sender_index: 'Grouping email by sender.',
  computing_recommendations: 'Preparing recommendations.',
  finalizing: 'Finishing up.',
  ready: 'Your inbox is ready.',
  failed: 'The scan stopped.',
};

/**
 * The sentence under the bar. "Your inbox is ready" is reachable ONLY
 * from `readiness_status === 'ready'` — the one signal that means it.
 * The worker writes late stages at 80–97% while the app is still gated —
 * seconds on a 101k-message mailbox (dev `sync_runs`, 2026-09; scoring is
 * queued, not run, in that stage) — and a stage/readiness disagreement
 * must never read as done (audit 2026-08-21).
 */
export function stageSentence(status: SyncStatus): string {
  if (status.readiness_status === 'ready') return STAGE_SENTENCE.ready;
  if (status.current_stage === 'ready') return STAGE_SENTENCE.finalizing;
  return STAGE_SENTENCE[status.current_stage];
}

/**
 * Home's syncing status. Only a stage the status read actually reports,
 * and never the queued sentence while a scan is already running.
 */
export function inProgressStageSentence(status: SyncStatus | undefined): string | null {
  if (!status || status.readiness_status !== 'syncing') return null;
  switch (status.current_stage) {
    case 'fetching_metadata':
    case 'building_sender_index':
    case 'computing_recommendations':
    case 'finalizing':
      return STAGE_SENTENCE[status.current_stage];
    case 'queued':
    case 'ready':
    case 'failed':
      return null;
    default: {
      const unreachable: never = status.current_stage;
      return unreachable;
    }
  }
}
