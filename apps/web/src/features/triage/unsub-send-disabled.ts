import { apiErrorCode } from '@/lib/api/client';

/**
 * The environment refuses to send unsubscribes (`UNSUB_SEND_ENABLED` is not
 * `true`), so the API answered 409 before writing anything.
 *
 * A DESIGNED state, not a failure. Nothing is half-finished: no `action_jobs`
 * row, no activity row, nothing queued, nothing to retry. Callers must
 * therefore skip `captureFeatureException` — a refusal reported as an
 * exception trains whoever watches that channel to ignore it — and must say
 * NOTHING WAS SENT in those words, because whether their address reached a
 * third party's list processor is the one fact a user cannot be left to guess.
 *
 * A shared predicate because three separate handlers raise an unsubscribe
 * (the Triage row intent, the Triage composite, and Senders) and the first
 * attempt at this patched only two of them. The third still fired Sentry, and
 * only a live smoke found it — the copy read fine, so nothing on screen said
 * the channel had just been polluted.
 */
export function isUnsubSendDisabled(err: unknown): boolean {
  return apiErrorCode(err) === 'UNSUB_SEND_DISABLED';
}

/** The one sentence every surface shows for it. */
export const UNSUB_SEND_DISABLED_MESSAGE =
  'Unsubscribe sending is turned off in this environment — nothing was sent.';
