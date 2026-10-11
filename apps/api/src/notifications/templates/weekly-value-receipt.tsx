import type { WeeklyValueReceiptFacts } from '@declutrmail/workers';
import { postalAddressLine } from '@declutrmail/shared/copy';
import { pluralWs4, WS4_COPY } from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';
import { formatNumber, type RenderedEmail } from './shell.js';

export interface WeeklyValueReceiptEmailInput {
  /** The week's recorded outcomes, computed by `WeeklyValueReceiptWorker`. */
  facts: WeeklyValueReceiptFacts;
  /** Web app origin. */
  appUrl: string;
  /** Signed one-click unsubscribe URL, also used by the RFC 8058 headers. */
  unsubscribeUrl: string;
}

/**
 * D189 amended by D251 — the opt-in Plus/Pro weekly value receipt.
 * A line appears only when its number is both known and nonzero.
 * Plain text. Counts and DeclutrMail URLs only.
 */
export function weeklyValueReceiptEmail(input: WeeklyValueReceiptEmailInput): RenderedEmail {
  const copy = WS4_COPY.email.weekly;
  const appUrl = input.appUrl.replace(/\/$/, '');
  const preferencesUrl = `${appUrl}/settings#notifications`;
  const homeUrl = emailLink(`${appUrl}/home`, { template: 'weekly' });
  const detailUrl = emailLink(`${appUrl}/activity`, { template: 'weekly_detail' });
  const { facts } = input;

  const lines: string[] = [];
  if (facts.automatedMessages > 0) {
    lines.push(
      `- ${pluralWs4(copy.rules, facts.automatedMessages, { n: formatNumber(facts.automatedMessages) })}`,
    );
  }
  if (facts.ownDecisions > 0) {
    lines.push(
      `- ${pluralWs4(copy.decided, facts.ownDecisions, { n: formatNumber(facts.ownDecisions) })}`,
    );
  }
  if (facts.briefSurfaced !== null && facts.briefSurfaced > 0) {
    lines.push(
      `- ${pluralWs4(copy.brief, facts.briefSurfaced, { n: formatNumber(facts.briefSurfaced) })}`,
    );
  }
  if (facts.undone > 0) {
    lines.push(`- ${pluralWs4(copy.undone, facts.undone, { n: formatNumber(facts.undone) })}`);
  }

  const text = [
    ...(lines.length > 0 ? [copy.intro, ...lines, ''] : []),
    ...(facts.pendingScreener > 0
      ? [
          pluralWs4(copy.screener, facts.pendingScreener, {
            n: formatNumber(facts.pendingScreener),
          }),
          '',
        ]
      : []),
    copy.trust,
    '',
    `${copy.button}: ${homeUrl}`,
    `${copy.detail}: ${detailUrl}`,
    '',
    '— DeclutrMail',
    '',
    copy.footer,
    `${WS4_COPY.email.unsubscribe}: ${input.unsubscribeUrl}`,
    `${WS4_COPY.email.preferences}: ${preferencesUrl}`,
    ...(postalAddressLine() ? [postalAddressLine() as string] : []),
  ].join('\n');

  return { subject: copy.subject, text };
}
