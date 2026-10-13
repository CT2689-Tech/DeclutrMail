import { describe, expect, it } from 'vitest';

import {
  formatReportSize,
  reportFallback,
  reportGlyph,
  reportHeadline,
  reportSupport,
} from './present';
import type { InboxReportInsight } from './types';

describe('report presentation', () => {
  it('formats sizes as MB under 1 GB and GB above it', () => {
    expect(formatReportSize(1_500_000)).toBe('1.5 MB');
    expect(formatReportSize(1_500_000_000)).toBe('1.5 GB');
  });

  it('hides the glyph row under 40% and rounds to the nearest tenth', () => {
    expect(reportGlyph(39)).toBeNull();
    expect(reportGlyph(91)).toEqual({ n: 9 });
  });

  it('fills the mostly-unread support line with the sender count', () => {
    const one: InboxReportInsight = {
      id: 'mostly_unread_share',
      pct: 91,
      senderCount: 1,
      sweeperExcluded: 0,
      window: '90d',
    };
    expect(reportSupport(one)).toBe(
      'That sender had less than 10% of its email marked read in Gmail in that time.',
    );
    const many: InboxReportInsight = { ...one, senderCount: 1200 };
    expect(reportSupport(many)).toBe(
      'Each of those 1,200 senders had less than 10% of its email marked read in Gmail in that time.',
    );
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

  it('formats the third-party headline and a large-mail count with thousands separators', () => {
    const thirdParty: InboxReportInsight = {
      id: 'third_party_labels',
      count: 20950,
      bytes: 1_200_000_000,
      recent90: 400,
      vendorKey: 'unroll_me',
    };
    expect(reportHeadline(thirdParty).sentence).toBe(
      '20,950 emails (about 1.2 GB) are filed under labels from other apps in your Gmail.',
    );
    const large: InboxReportInsight = {
      id: 'large_mail',
      count: 12481,
      bytes: 2_400_000_000,
      top10Bytes: 1_000_000_000,
    };
    expect(reportHeadline(large).sentence).toContain('12,481');
    expect(reportHeadline(large).sentence).not.toContain('12481');
  });

  it('keeps a one-email sentence on the singular deck line', () => {
    const insight: InboxReportInsight = {
      id: 'third_party_labels',
      count: 1,
      bytes: 1_500_000,
      recent90: 1,
      vendorKey: 'unroll_me',
    };
    expect(reportHeadline(insight).sentence).toBe(
      '1 email (about 1.5 MB) is filed under a label from another app in your Gmail.',
    );
  });

  it('formats fallback totals without changing the one-sender sentence', () => {
    expect(reportFallback({ receivedCount: 20950, fallbackSenderCount: 1200 }).body).toContain(
      '20,950 emails',
    );
    expect(reportFallback({ receivedCount: 20950, fallbackSenderCount: 1200 }).body).toContain(
      '1,200 senders',
    );
    expect(reportFallback({ receivedCount: 12, fallbackSenderCount: 1 }).body).toContain(
      '12 emails',
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
