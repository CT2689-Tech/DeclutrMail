import type { BulkSkipReason } from '@/lib/api/actions';

import { CHECK_ACTIVITY, enqueueMayHaveStarted, protectedSkippedCopy } from './action-error-copy';

/**
 * Copy only the screens that start bulk or Unsubscribe-plus-cleanup actions
 * need (Senders, Sender Detail, Triage, the Brief). It lives apart from
 * `action-error-copy` because the app chrome's pill imports that module on
 * every route, and a bundler keeps or drops a module whole: kept there, it
 * rode every route's first load (bundle budget, D245).
 */

/**
 * An Unsubscribe was recorded, but the cleanup of older email that rode
 * with it failed to enqueue. One sentence for Senders, Sender Detail and
 * Triage. The request stands (D58), so it is "recorded", never "started":
 * a mailto request is the user's to send.
 */
export function backlogAfterUnsubFailureCopy(options: {
  readonly verb: 'Archive' | 'Delete';
  /** Omitted for a multi-sender batch. */
  readonly senderName?: string;
  readonly error: unknown;
}): string {
  const { verb, senderName, error } = options;
  const requests = senderName ? 'Unsubscribe request' : 'Unsubscribe requests';
  const mail = senderName ? `older email from ${senderName}` : 'older email';
  return enqueueMayHaveStarted(error)
    ? `${requests} recorded, but can't tell if ${verb} started for ${mail} — ${CHECK_ACTIVITY}.`
    : `${requests} recorded, but ${mail} wasn't ${verb === 'Delete' ? 'deleted' : 'archived'} — ${verb} it separately.`;
}

/**
 * What an Archive/Later/Delete bulk refused at the click, in the pill's
 * words: "Archive: 1 Protected sender skipped · 1 sender already busy · 1
 * sender no longer in this mailbox". `null` when it refused nothing. Label
 * bulks refuse for these three reasons only (an Unsubscribe bulk has its
 * own receipt).
 */
export function skippedAtClickCopy(
  verb: 'Archive' | 'Later' | 'Delete',
  skipped: readonly { reason: BulkSkipReason }[],
): string | null {
  const protectedCount = skipped.filter((s) => s.reason === 'protected').length;
  const busy = skipped.filter((s) => s.reason === 'in_progress').length;
  const missing = skipped.filter((s) => s.reason === 'not_found').length;
  const parts = [
    ...(protectedCount > 0 ? [protectedSkippedCopy(protectedCount)] : []),
    ...(busy > 0
      ? [`${busy.toLocaleString('en-US')} sender${busy === 1 ? '' : 's'} already busy`]
      : []),
    ...(missing > 0
      ? [
          `${missing.toLocaleString('en-US')} sender${missing === 1 ? '' : 's'} no longer in this mailbox`,
        ]
      : []),
  ];
  return parts.length > 0 ? `${verb}: ${parts.join(' · ')}` : null;
}

/**
 * `NO_ACTIONABLE_SENDERS` — an Archive/Later/Delete bulk refused every
 * sender at the click. A designed state, not a failure, and the server
 * does not say which reason was whose.
 */
export const NO_ACTIONABLE_SENDERS_COPY =
  'Nothing changed — those senders are Protected or no longer in this mailbox.';
