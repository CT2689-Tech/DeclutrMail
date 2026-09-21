import type { UnsubscribeLifecycleStatus } from '@declutrmail/shared/contracts';

import type { Sender } from './data';

/**
 * Unsubscribe status copy by execution state (D9 Wave 2 — honest states,
 * never a promised outcome). `none` covers a recorded intent with NO
 * tracked execution — a mailto sender whose manual send happens from
 * Sender Detail (D230), or method-none.
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
  const resolved =
    status ??
    (method === 'mailto' ? 'action_required' : method === 'none' ? 'unavailable' : 'requested');
  return UNSUB_PILL[resolved];
}
