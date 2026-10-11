import type { HomeFixCopy } from './home-ws5-copy';
import type { HomePreviewState } from './home-preview-state';

/**
 * Preview-only Inbox Report sentences. They are the WS5 deck strings, with
 * sample counts filled in, so a full Home can be checked before that deck
 * is on this branch. Production Home does not read this module.
 */
export interface HomePreviewReport {
  title: string;
  body: string;
  cta: string;
  headline: string;
  trust: string;
  trustLink: string;
  calm: string | null;
  tileValue: string | null;
  tileLabel: string | null;
  tileNote: string | null;
  fix: HomeFixCopy;
}

const FIX: HomeFixCopy = {
  headingOne: '1 of these senders includes an unsubscribe link.',
  headingOther: '{n} of these senders include an unsubscribe link.',
  primaryOne: 'Unsubscribe + archive 1 sender',
  primaryOther: 'Unsubscribe + archive {n} senders',
  review: 'Review them first',
  supportOne: 'It had less than 10% of its email marked read in Gmail in that time.',
  supportOther: 'Each had less than 10% of its email marked read in Gmail in that time.',
  titleOne: 'Unsubscribe from {Sender} and archive 1 email?',
  titleOther: 'Unsubscribe from {Sender} and archive {n} emails?',
  titleBulk: 'Unsubscribe from {k} senders and archive {n} emails?',
  button: 'Unsubscribe + Archive',
  cancel: 'Cancel',
  honesty:
    'The unsubscribe request can\u2019t be recalled once delivered. The archive can be undone from Activity for 30 days.',
};

/** Full, no-size, and caught-up. Other preview states leave the report off. */
export function homePreviewReport(state: HomePreviewState): HomePreviewReport | null {
  if (state !== 'full' && state !== 'no-size' && state !== 'caught-up') return null;
  const sized = state !== 'caught-up';
  return {
    title: 'Your Inbox Report',
    body: 'A quick look at who sends you the most, what you leave unread and what takes up space.',
    cta: 'Open report',
    headline:
      '91% of the email you got in the last 90 days came from 195 senders you mostly leave unread.',
    trust:
      'This report uses only the sender, date, size, labels and read/unread status of your email, plus who you\u2019ve emailed. We never fetch or store full email contents.',
    trustLink: 'What we store and share',
    calm:
      state === 'caught-up'
        ? 'Your inbox is in good shape. 47 emails, and nothing stands out yet.'
        : null,
    tileValue: sized ? '\u2248 7.7 GB' : null,
    tileLabel: sized ? 'of email in your Gmail' : null,
    tileNote: sized ? 'Sizes are Gmail\u2019s estimates.' : null,
    fix: FIX,
  };
}
