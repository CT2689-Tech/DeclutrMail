import { postalAddressLine } from '@declutrmail/shared/copy';

import type { RenderedEmail } from './shell.js';

export interface WeeklyValueReceiptEmailInput {
  /** Current pending Screener rows across the user's connected Gmail accounts. */
  pendingCount: number;
  /** Web app origin. */
  appUrl: string;
  /** Signed one-click unsubscribe URL, also used by the RFC 8058 headers. */
  unsubscribeUrl: string;
}

/**
 * D189 amended by D251 — the opt-in Plus/Pro weekly Screener value cue.
 *
 * Plain text is decision-locked. The body carries only a current count
 * and DeclutrMail URLs: no sender identities and no mailbox content.
 */
export function weeklyValueReceiptEmail(input: WeeklyValueReceiptEmailInput): RenderedEmail {
  const appUrl = input.appUrl.replace(/\/$/, '');
  const screenerUrl = `${appUrl}/screener`;
  const preferencesUrl = `${appUrl}/settings#notifications`;
  const subject = `${input.pendingCount} new senders are ready for review`;

  const text = [
    subject,
    '',
    'They still arrived in Gmail. Screener keeps the decisions together',
    'so you can review the batch when you are ready.',
    '',
    `Review new senders: ${screenerUrl}`,
    '',
    '— DeclutrMail',
    '',
    'You opted in to the weekly value receipt in Settings.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
    `Email preferences: ${preferencesUrl}`,
    ...(postalAddressLine() ? [postalAddressLine() as string] : []),
  ].join('\n');

  return { subject, text };
}
