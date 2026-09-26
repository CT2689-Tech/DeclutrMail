import {
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  UNSUB_MANUAL_REQUIRED_ERROR_CODE,
} from '@declutrmail/shared/contracts';

import type { ActionStatusResult } from '@/lib/api/actions';

/**
 * The toast for a finished one-click unsubscribe. Triage, Screener, Senders
 * and Sender Detail watch the same job, and this reads the job's error code
 * the way the row pill (`unsub-status.ts`) reads the lifecycle: a request
 * the endpoint did not accept (any 4xx or 5xx), from a sender that also
 * takes email (`UNSUB_MANUAL_REQUIRED`), is "Send from Gmail" on the row, so it is not "failed — Archive still
 * works", which hid the one step that still unsubscribes.
 *
 * Its own module so Triage and Screener do not carry the pill table.
 */
export function unsubscribeOutcomeToast(
  senderName: string,
  outcome: Pick<ActionStatusResult, 'status' | 'errorCode'>,
): { message: string; tone: 'success' | 'warn' } {
  if (outcome.status === 'done') {
    return {
      message: `${senderName} accepted the unsubscribe request — stopping is up to them.`,
      tone: 'success',
    };
  }
  if (outcome.errorCode === UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE) {
    return {
      message: `Unsubscribe from ${senderName} is unconfirmed — watch for new email.`,
      tone: 'warn',
    };
  }
  if (outcome.errorCode === UNSUB_MANUAL_REQUIRED_ERROR_CODE) {
    return {
      message: `${senderName} didn't accept the one-click request — send the unsubscribe email from Gmail instead.`,
      tone: 'warn',
    };
  }
  return { message: `Unsubscribe from ${senderName} failed — Archive still works.`, tone: 'warn' };
}
