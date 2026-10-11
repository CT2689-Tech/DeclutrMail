import { postalAddressLine } from '@declutrmail/shared/copy';
import { connectedFooter, fillWs4, pluralWs4, WS4_COPY } from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';
import { formatNumber, type RenderedEmail } from './shell.js';

export interface LapseReengagementEmailInput {
  /**
   * Senders awaiting a first decision across ALL of the user's active
   * mailboxes — an account-wide total. Not the per-mailbox Triage read.
   */
  pendingCount: number;
  /** Web app origin. */
  appUrl: string;
  /** Signed one-click unsubscribe URL, also used by the RFC 8058 headers. */
  unsubscribeUrl: string;
}

/**
 * D126 Part 3 — the lapse re-engagement email.
 * Plain text, no HTML alternative.
 * Carries only a count and DeclutrMail URLs: no sender identities, no
 * subjects, no mailbox content (D7/D228).
 */
export function lapseReengagementEmail(input: LapseReengagementEmailInput): RenderedEmail {
  const copy = WS4_COPY.email.lapse;
  const appUrl = input.appUrl.replace(/\/$/, '');
  const subject = pluralWs4(copy.subject, input.pendingCount, {
    n: formatNumber(input.pendingCount),
  });
  const homeUrl = emailLink(`${appUrl}/home`, { template: 'lapse' });
  const preferencesUrl = `${appUrl}/settings#notifications`;

  const text = [
    subject,
    '',
    fillWs4(copy.body),
    '',
    copy.keys,
    '',
    `${copy.button}: ${homeUrl}`,
    '',
    '— DeclutrMail',
    '',
    connectedFooter('a'),
    `${WS4_COPY.email.unsubscribe}: ${input.unsubscribeUrl}`,
    `${WS4_COPY.email.preferences}: ${preferencesUrl}`,
    ...(postalAddressLine() ? [postalAddressLine() as string] : []),
  ].join('\n');

  return { subject, text };
}
