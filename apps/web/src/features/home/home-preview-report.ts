import { fillCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { HomeFixCopy } from './home-ws5-copy';
import type { HomePreviewState } from './home-preview-state';

/**
 * Preview-only Inbox Report sentences. They are the WS5 deck strings, with
 * sample counts filled in. Production Home does not read this module.
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

/** The unread set in the sample headline. The unsubscribe step counts a subset. */
const UNREAD_SENDERS = 195;

const FIX: HomeFixCopy = {
  headingOne: WS5_COPY['report.fix.heading'].one,
  headingOther: WS5_COPY['report.fix.heading'].other,
  primaryOne: WS5_COPY['report.fix.primary'].one,
  primaryOther: WS5_COPY['report.fix.primary'].other,
  review: WS5_COPY['report.fix.review'],
  supportOne: pluralCopy(WS5_COPY['report.mostlyUnread.support'], 1),
  supportOther: pluralCopy(WS5_COPY['report.mostlyUnread.support'], UNREAD_SENDERS),
  titleThisSender: WS5_COPY['preview.title.unsubThisSender'],
  titleBulkOne: WS5_COPY['preview.title.bulk.unsub'].one,
  titleBulkOther: WS5_COPY['preview.title.bulk.unsub'].other,
  button: WS5_COPY['f1.button.archive'],
  cancel: WS5_COPY['f1.button.cancel'],
  honesty: WS5_COPY['f1.honesty.archive'],
};

/** Full, no-size, and caught-up. Other preview states leave the report off. */
export function homePreviewReport(state: HomePreviewState): HomePreviewReport | null {
  if (state !== 'full' && state !== 'no-size' && state !== 'caught-up') return null;
  const sized = state !== 'caught-up';
  return {
    title: WS5_COPY['report.home.title'],
    body: WS5_COPY['report.home.body'],
    cta: WS5_COPY['report.home.cta'],
    headline: pluralCopy(WS5_COPY['report.mostlyUnread.headline'], UNREAD_SENDERS, {
      pct: 91,
      n: UNREAD_SENDERS.toLocaleString('en-US'),
    }),
    trust: WS5_COPY['report.trust'],
    trustLink: WS5_COPY['report.trust.link'],
    calm:
      state === 'caught-up' ? fillCopy(WS5_COPY['report.fallback.zero'], { total: '47' }) : null,
    tileValue: sized ? fillCopy(WS5_COPY['f2.homeTile.value'], { size: '7.7 GB' }) : null,
    tileLabel: sized ? WS5_COPY['f2.homeTile.label'] : null,
    tileNote: sized ? WS5_COPY['report.sizesNote'] : null,
    fix: FIX,
  };
}
