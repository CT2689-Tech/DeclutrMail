import { describe, expect, it } from 'vitest';

import { formatReportSize, reportFallback, reportGlyph, reportHeadline } from './present';
import type { InboxReportInsight } from './types';

describe('report presentation', () => {
  it('formats sizes as MB under 1 GB and GB above it', () => {
    expect(formatReportSize(1_500_000)).toBe('1.5 MB');
    expect(formatReportSize(1_500_000_000)).toBe('1.5 GB');
  });

  it('hides the glyph row under 40% and rounds to the nearest tenth', () => {
    expect(reportGlyph(39)).toBeNull();
    expect(reportGlyph(91)?.label).toBe('about 9 in 10');
  });

  it('uses the deck headline for mostly-unread senders', () => {
    const insight: InboxReportInsight = {
      id: 'mostly_unread_share',
      pct: 91,
      senderCount: 195,
      sweeperExcluded: 0,
      window: '90d',
    };
    expect(reportHeadline(insight).sentence).toBe(
      '91% of the email you got in the last 90 days came from 195 senders you mostly leave unread.',
    );
  });

  it('gives the calm fallback a different sentence for 2, 1, and 0 senders', () => {
    expect(reportFallback({ receivedCount: 12, fallbackSenderCount: 2 }).cta).toBe(
      'Show those 2 senders',
    );
    expect(reportFallback({ receivedCount: 12, fallbackSenderCount: 1 }).cta).toBe(
      'Show that sender',
    );
    expect(reportFallback({ receivedCount: 12, fallbackSenderCount: 0 }).cta).toBeNull();
    expect(reportFallback({ receivedCount: 12, fallbackSenderCount: 0 }).body).toContain(
      'nothing stands out yet',
    );
  });
});
