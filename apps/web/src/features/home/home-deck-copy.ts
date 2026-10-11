import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';

/**
 * Verbatim launch-deck sentences Home v1 renders.
 * WS2 keys come from the checked-in module. WS1 meter and WS5 report
 * sentences are quoted here because those modules are owned by other
 * workstreams and are still empty. Deck revision: drop2-r6.
 */
export const HOME_DECK = {
  homeTitle: WS2_COPY.names.home,
  nextSteps: WS2_COPY.names.homeNextSteps,
  retrying: WS2_COPY.home.retrying,
  reconnect: WS2_COPY.home.reconnect,
  compare: WS2_COPY.locked.compare,
  reportTitle: 'Your Inbox Report',
  reportBody:
    'A quick look at who sends you the most, what you leave unread and what takes up space.',
  trust:
    'This report uses only the sender, date, size, labels and read/unread status of your email, plus who you’ve emailed. We never fetch or store full email contents.',
  trustLink: 'What we store and share',
  fallbackZero: 'Your inbox is in good shape. {total} emails, and nothing stands out yet.',
  fixHeadingOne: '1 of these senders includes an unsubscribe link.',
  fixHeadingOther: '{n} of these senders include an unsubscribe link.',
  fixPrimaryOne: 'Unsubscribe + archive 1 sender',
  fixPrimaryOther: 'Unsubscribe + archive {n} senders',
  fixReview: 'Review them first',
  mostlyUnreadSupportOne: 'It had less than 10% of its email marked read in Gmail in that time.',
  mostlyUnreadSupportOther:
    'Each had less than 10% of its email marked read in Gmail in that time.',
  tileValue: '≈ {size}',
  tileLabel: 'of email in your Gmail',
  sizesNote: 'Sizes are Gmail’s estimates.',
  top10: 'Your 10 largest senders take up about {size} of your email.',
  storageNote:
    'Deleted email keeps using Gmail storage until Trash is emptied. Gmail empties it after 30 days.',
  largestSort: 'Largest senders',
  f1TitleOne: 'Unsubscribe from {Sender} and archive 1 email?',
  f1TitleOther: 'Unsubscribe from {Sender} and archive {n} emails?',
  f1TitleBulk: 'Unsubscribe from {k} senders and archive {n} emails?',
  f1Button: 'Unsubscribe + Archive',
  f1Cancel: 'Cancel',
  f1Honesty:
    'The unsubscribe request can’t be recalled once delivered. The archive can be undone from Activity for 30 days.',
  chip: '{remaining} of {allowance} free emails left · resets {resetDate}',
  chipAria: '{remaining} of {allowance} free emails left this month. Resets {resetDate}.',
  chipEmpty: 'No free emails left · resets {resetDate}',
  chipCompact: '{remaining} of {allowance} left',
  previewFitsOne: 'This clears 1 email. You have {remaining} free this month.',
  previewFitsOther: 'This clears {requested} emails. You have {remaining} free this month.',
  previewOver: 'This clears {requested} emails. You have {remaining} free left this month.',
  previewFree: 'Unsubscribing is free and doesn’t count.',
  activityLink: 'See your activity',
} as const;

export function fillDeck(template: string, vars: Record<string, string | number>): string | null {
  const missing = template.match(/\{(\w+)\}/g)?.some((token) => {
    const key = token.slice(1, -1);
    const value = vars[key];
    return value === undefined || value === '';
  });
  if (missing) return null;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key]));
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatResetDate(iso: string, timeZone: string): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  });
}

export function formatRetryTime(iso: string, timeZone: string): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  });
}

/** Deck chip sentence from server meter fields. Null when the workspace is not metered. */
export function meterChipSentence(
  summary: CleanupSummaryDto,
  options: { compact?: boolean; timeZone: string },
): { text: string; aria: string } | null {
  if (!summary.metered) return null;
  const resetDate = formatResetDate(summary.resetAt, options.timeZone);
  if (resetDate === null) return null;
  const remaining = formatCount(summary.remaining);
  const allowance = formatCount(summary.limit);
  if (summary.remaining <= 0) {
    const text = fillDeck(HOME_DECK.chipEmpty, { resetDate });
    return text === null ? null : { text, aria: text };
  }
  const aria = fillDeck(HOME_DECK.chipAria, { remaining, allowance, resetDate });
  const text = options.compact
    ? fillDeck(HOME_DECK.chipCompact, { remaining, allowance })
    : fillDeck(HOME_DECK.chip, { remaining, allowance, resetDate });
  if (text === null || aria === null) return null;
  return { text, aria };
}

/**
 * Deck preview sentence. Uses the email count, never a sender-unit count.
 * Over-allowance keeps the confirm available; it does not invent a block.
 */
export function meterPreviewSentence(requested: number, remaining: number): string | null {
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(remaining)) return null;
  const remainingLabel = formatCount(remaining);
  if (requested > remaining) {
    return fillDeck(HOME_DECK.previewOver, {
      requested: formatCount(requested),
      remaining: remainingLabel,
    });
  }
  if (requested === 1) return fillDeck(HOME_DECK.previewFitsOne, { remaining: remainingLabel });
  return fillDeck(HOME_DECK.previewFitsOther, {
    requested: formatCount(requested),
    remaining: remainingLabel,
  });
}
