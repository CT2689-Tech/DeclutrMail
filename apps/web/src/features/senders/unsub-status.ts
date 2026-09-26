import {
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  UNSUB_MANUAL_REQUIRED_ERROR_CODE,
  type UnsubscribeLifecycleStatus,
} from '@declutrmail/shared/contracts';

import type { ActionStatusResult } from '@/lib/api/actions';

import type { Sender } from './data';

/**
 * Unsubscribe status copy by execution state (D9 Wave 2 — honest states,
 * never a promised outcome). A null status on a one-click intent is a
 * legacy record from before execution tracking, so its outcome is unknown.
 * Mailto and method-none intents have their own fallback copy.
 *
 * The ONE copy source for the status: the list row and the Sender Detail
 * header render the same map, so list ↔ detail never contradict.
 */
export const UNSUB_PILL: Record<UnsubscribeLifecycleStatus, { label: string; title: string }> = {
  requested: {
    label: 'Requesting…',
    title: 'Your unsubscribe request is being delivered to the sender',
  },
  endpoint_accepted: {
    label: 'Request accepted',
    title: "The sender's system accepted the request; whether email stops is up to them",
  },
  failed: {
    label: 'Request failed',
    title: 'The unsubscribe request failed; Archive remains available for current email',
  },
  unconfirmed: {
    label: 'Result unconfirmed',
    title: "We couldn't confirm the sender received the request; watch for future email",
  },
  action_required: {
    label: 'Send from Gmail',
    title: 'This sender requires an email request that you send from Gmail',
  },
  draft_opened: {
    label: 'Draft opened',
    title: 'The Gmail draft was opened; DeclutrMail has not been told it was sent',
  },
  user_marked_sent: {
    label: 'Marked sent',
    title:
      'You reported sending the unsubscribe email; future delivery still depends on the sender',
  },
  unavailable: {
    label: 'Unavailable',
    title: "This sender doesn't offer an unsubscribe link DeclutrMail can use",
  },
};

export function unsubscribeStatusCopy(
  status: UnsubscribeLifecycleStatus | null | undefined,
  method: Sender['unsubscribeMethod'],
): { label: string; title: string } {
  if (status == null && method === 'one_click') {
    return {
      label: 'Outcome unknown',
      title: 'This earlier unsubscribe has no delivery record, so we cannot confirm its outcome',
    };
  }
  const resolved =
    status ??
    (method === 'mailto' ? 'action_required' : method === 'none' ? 'unavailable' : 'unconfirmed');
  return UNSUB_PILL[resolved];
}

/**
 * The toast for a finished one-click unsubscribe. Triage, Screener, Senders
 * and Sender Detail watch the same job, and it reads the job's error code
 * the way the pill above reads the lifecycle: a refused request from a
 * sender that also takes email (`UNSUB_MANUAL_REQUIRED`) is "Send from
 * Gmail" on the row, so it is not "failed — Archive still works", which
 * hid the one step that still unsubscribes.
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
      message: `${senderName} refused the one-click request — send the unsubscribe email from Gmail instead.`,
      tone: 'warn',
    };
  }
  return { message: `Unsubscribe from ${senderName} failed — Archive still works.`, tone: 'warn' };
}
