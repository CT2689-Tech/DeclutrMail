import type { WeeklyValueReceiptFacts } from '@declutrmail/workers';
import { postalAddressLine } from '@declutrmail/shared/copy';

import { formatCount, type RenderedEmail } from './shell.js';

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
 *
 * D189's point is that the receipt is the subscription justifying
 * itself — "DeclutrMail protected you this week", not "come back and use
 * DeclutrMail". So every line is something that HAPPENED, drawn from the
 * Activity ledger, the Brief runs, and the Screener queue.
 *
 * A line appears only when its number is both KNOWN and nonzero. That is
 * not cosmetic: printing a 0 for a figure nothing recorded is this
 * codebase's dominant defect (a surface asserting what it does not
 * know), and printing one for a real 0 turns a receipt into a scolding.
 * The worker suppresses the send entirely when every number is zero.
 *
 * The closing line is D189's load-bearing trust line. It is stated as
 * the guarantee it is, and it is checkable: Delete adds Gmail's TRASH
 * label (`GmailMutationClient`), and no code path anywhere calls Gmail's
 * permanent `messages.delete`.
 *
 * Plain text is decision-locked. The body carries only counts and
 * DeclutrMail URLs: no sender identities and no mailbox content.
 */
export function weeklyValueReceiptEmail(input: WeeklyValueReceiptEmailInput): RenderedEmail {
  const appUrl = input.appUrl.replace(/\/$/, '');
  const preferencesUrl = `${appUrl}/settings#notifications`;
  const { facts } = input;
  const subject = 'Your week with DeclutrMail';

  const lines: string[] = [];
  if (facts.automatedMessages > 0) {
    lines.push(
      `- ${formatCount(facts.automatedMessages, 'message', 'messages')} kept out of your inbox by rules you turned on`,
    );
  }
  if (facts.ownDecisions > 0) {
    lines.push(`- ${formatCount(facts.ownDecisions, 'sender', 'senders')} you decided on yourself`);
  }
  if (facts.briefSurfaced !== null && facts.briefSurfaced > 0) {
    lines.push(
      `- ${formatCount(facts.briefSurfaced, 'sender', 'senders')} surfaced in your Brief as worth reading`,
    );
  }
  if (facts.undone > 0) {
    lines.push(`- ${formatCount(facts.undone, 'action', 'actions')} you undid`);
  }

  const text = [
    // The heading only appears over lines that belong under it. A week
    // where the Screener backlog is the sole fact gets no "This week
    // DeclutrMail:" — there is nothing to list beneath it.
    ...(lines.length > 0 ? ['This week DeclutrMail:', ...lines, ''] : []),
    // Deliberately NOT a bullet in the list above: this is current
    // state, not something that happened during the week, and filing it
    // under "this week" would quietly change what the number means.
    ...(facts.pendingScreener > 0
      ? [
          `${formatCount(facts.pendingScreener, 'new sender is', 'new senders are')} waiting in Screener right now.`,
          '',
        ]
      : []),
    'Nothing was deleted permanently. Delete moves mail to Gmail Trash,',
    'where Gmail keeps it recoverable for 30 days.',
    '',
    `See the detail: ${appUrl}/activity`,
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
