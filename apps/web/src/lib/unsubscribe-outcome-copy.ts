import type { ToastTone } from '@declutrmail/shared';
import {
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  UNSUB_SENDER_PROTECTED_ERROR_CODE,
} from '@declutrmail/shared/contracts';

/**
 * The toast for a single-sender one-click unsubscribe that reached a
 * terminal status. One copy source for Senders, Sender Detail, Triage and
 * the Screener, so the four never word the same outcome differently.
 * "Accepted" is deliberate: a 2xx proves the sender's endpoint took the
 * request, not that the email stops.
 */
export function unsubscribeOutcomeToast(
  senderName: string,
  outcome: { readonly status: string; readonly errorCode: string | null },
): [message: string, tone: ToastTone] {
  if (outcome.status === 'done') {
    return [`${senderName} accepted the unsubscribe request — stopping is up to them.`, 'success'];
  }
  if (outcome.errorCode === UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE) {
    return [`Unsubscribe from ${senderName} is unconfirmed — watch for new email.`, 'warn'];
  }
  // Refused before anything was sent: the sender was Protected when the
  // request was due (D245).
  if (outcome.errorCode === UNSUB_SENDER_PROTECTED_ERROR_CODE) {
    return [`Unsubscribe from ${senderName} not sent — sender is Protected.`, 'info'];
  }
  return [`Unsubscribe from ${senderName} failed — Archive still works.`, 'warn'];
}
