import { postalAddressLine } from '@declutrmail/shared/copy';

import { formatCount, type RenderedEmail } from './shell.js';

export interface LapseReengagementEmailInput {
  /**
   * Senders awaiting a first decision across ALL of the user's active
   * mailboxes — an account-wide total.
   *
   * Deliberately NOT "the number on the Triage screen": that read is
   * scoped to one mailbox and does show Keep and protected rows, which
   * this count drops. The copy below says "across your mailboxes" and
   * never claims the two are equal.
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
 * senders await a first decision ACROSS the account's mailboxes, and
 * that the user has not been seen for five days (the producer's band
 * guarantees at least that). It does not say the number equals what
 * Triage shows — that read is per-mailbox and includes rows this count
 * drops. It deliberately
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
  const subject = `${formatCount(input.pendingCount, 'sender is', 'senders are')} waiting on a decision`;

  const text = [
    subject,
    '',
    'You have not opened DeclutrMail for five days. This is the number',
    'of senders still waiting for your first decision across all your',
    'mailboxes. Triage shows one mailbox at a time.',
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
