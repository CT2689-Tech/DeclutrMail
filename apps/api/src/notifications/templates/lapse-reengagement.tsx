import { postalAddressLine } from '@declutrmail/shared/copy';

import { formatCount, type RenderedEmail } from './shell.js';

export interface LapseReengagementEmailInput {
  /**
   * Senders currently awaiting a first decision in Triage, across the
   * user's active mailboxes. Computed with the Triage queue's OWN
   * exclusion rule, so this is the number the queue shows on arrival.
   */
  pendingCount: number;
  /** Web app origin. */
  appUrl: string;
  /** Signed one-click unsubscribe URL, also used by the RFC 8058 headers. */
  unsubscribeUrl: string;
}

/**
 * D126 Part 3 — the lapse re-engagement email ("Day 7 if not active in
 * 5 days").
 *
 * Plain text, no HTML alternative: D126 Part 3 locks the whole sequence
 * to "Plain text only; no marketing chrome", and `EmailSendJobData.html`
 * is optional precisely so a kind the plan forbids a body cannot be
 * given one.
 *
 * The copy asserts exactly two things, both recorded facts: how many
 * senders are waiting, and that the user has not been seen for five
 * days (the producer's band guarantees at least that). It deliberately
 * does NOT claim the inbox was untouched while they were away —
 * Autopilot in active mode acts without them, so that reassurance would
 * be false for exactly the users who most need it to be true. It also
 * makes no time-to-clear claim: D126's "30 seconds" is a guess, and the
 * keystrokes are the honest version of the same point.
 *
 * Carries only a count and DeclutrMail URLs: no sender identities, no
 * subjects, no mailbox content (D7/D228).
 */
export function lapseReengagementEmail(input: LapseReengagementEmailInput): RenderedEmail {
  const appUrl = input.appUrl.replace(/\/$/, '');
  const triageUrl = `${appUrl}/triage`;
  const preferencesUrl = `${appUrl}/settings#notifications`;
  const subject = `${formatCount(input.pendingCount, 'sender is', 'senders are')} waiting in Triage`;

  const text = [
    subject,
    '',
    'You have not opened DeclutrMail for five days. The queue held its',
    'place — every sender there is still waiting on your decision, not',
    'on us.',
    '',
    'One keystroke each: K to keep, A to archive, U to unsubscribe,',
    'L for later, D to delete.',
    '',
    `Open Triage: ${triageUrl}`,
    '',
    '— DeclutrMail',
    '',
    'You received this because you connected a mailbox to DeclutrMail.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
    `Email preferences: ${preferencesUrl}`,
    ...(postalAddressLine() ? [postalAddressLine() as string] : []),
  ].join('\n');

  return { subject, text };
}
