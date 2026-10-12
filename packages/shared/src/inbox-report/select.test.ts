import { describe, expect, it } from 'vitest';

import { selectInboxReport, isReportableInternalDate } from './select';
import { INBOX_REPORT_THRESHOLDS as T } from './thresholds';
import type { ReportFacts, ReportSenderFacts } from './types';

function sender(
  over: Partial<ReportSenderFacts> & Pick<ReportSenderFacts, 'senderId'>,
): ReportSenderFacts {
  return {
    inbound90: 10,
    markedRead90: 0,
    sweeperMarked90: 0,
    hasUnsubscribe: true,
    wroteToCount: 0,
    isProtected: false,
    isKeep: false,
    inboxCount: 4,
    ...over,
  };
}

function facts(over: Partial<ReportFacts> = {}): ReportFacts {
  return {
    receivedCount: 100,
    receivedBytes: 10_000,
    inbound90: 100,
    markedRead90: 10,
    peopleReceived: 50,
    largeCount: 0,
    largeBytes: 0,
    top10Bytes: 0,
    thirdPartyCount: 0,
    thirdPartyBytes: 0,
    thirdPartyRecent90: 0,
    vendorKey: null,
    oldestYear: 2024,
    olderThan3YearsCount: 0,
    top10Count: 10,
    trashCount: 0,
    trashBytes: 0,
    senders: [],
    nowYear: 2026,
    ...over,
  };
}

describe('isReportableInternalDate', () => {
  it('drops epoch and pre-1995 dates and keeps 1995', () => {
    expect(isReportableInternalDate(new Date('1970-01-01T00:00:00.000Z'))).toBe(false);
    expect(isReportableInternalDate(new Date('1994-12-31T23:59:59.000Z'))).toBe(false);
    expect(isReportableInternalDate(new Date('1995-01-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('selectInboxReport', () => {
  it('excludes a sender with 2 emails and includes one with 3', () => {
    const report = selectInboxReport(
      facts({
        inbound90: 5,
        markedRead90: 0,
        senders: [
          sender({ senderId: 'two', inbound90: 2, inboxCount: 2 }),
          sender({ senderId: 'three', inbound90: 3, inboxCount: 3 }),
        ],
      }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(report.fix.senderKeys).toEqual(['three']);
    expect(report.insights.find((insight) => insight.id === 'mostly_unread_share')).toMatchObject({
      senderCount: 1,
      pct: 60,
    });
  });

  it('does not treat a 10% marked-read sender as mostly unread', () => {
    const report = selectInboxReport(
      facts({
        senders: [sender({ senderId: 'edge', inbound90: 10, markedRead90: 1 })],
      }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(report.fix.senderKeys).toEqual([]);
  });

  it('suppresses mostly-unread when the mailbox itself is more than 80% marked read', () => {
    const report = selectInboxReport(
      facts({
        inbound90: 100,
        markedRead90: 81,
        senders: [sender({ senderId: 'quiet', inbound90: 50, markedRead90: 0 })],
      }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(report.insights.some((insight) => insight.id === 'mostly_unread_share')).toBe(false);
  });

  it('keeps mostly-unread when marked-read is exactly 80%', () => {
    const report = selectInboxReport(
      facts({
        inbound90: 100,
        markedRead90: 80,
        peopleReceived: 0,
        senders: [sender({ senderId: 'quiet', inbound90: 40, markedRead90: 0 })],
      }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(report.insights.some((insight) => insight.id === 'mostly_unread_share')).toBe(true);
  });

  it('ranks by the fixed priority and returns only the top three', () => {
    const report = selectInboxReport(
      facts({
        inbound90: 100,
        markedRead90: 0,
        peopleReceived: 10,
        largeBytes: T.largeMailMinBytes,
        largeCount: 2,
        thirdPartyCount: T.thirdPartyMinEmails,
        vendorKey: 'unroll_me',
        oldestYear: 2000,
        olderThan3YearsCount: 40,
        trashBytes: T.trashMinBytes,
        trashCount: 3,
        top10Count: 40,
        senders: [sender({ senderId: 'a', inbound90: 50 })],
      }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(report.insights.map((insight) => insight.id)).toEqual([
      'third_party_labels',
      'mostly_unread_share',
      'large_mail',
    ]);
    expect(report.variant).toBe('full');
  });

  it('uses the calm fallback for two, one, and zero worth-a-look senders when under two insights qualify', () => {
    for (const count of [2, 1, 0]) {
      const report = selectInboxReport(
        facts({
          senders: Array.from({ length: count }, (_, index) =>
            sender({ senderId: `s${index}`, inbound90: 3 }),
          ),
          inbound90: 3 * count,
        }),
        '2026-10-11T00:00:00.000Z',
      );
      expect(report.variant).toBe('fallback');
      expect(report.fallbackSenderCount).toBe(count);
    }
  });

  it('excludes protected, written-to, and Keep senders and caps the fix set', () => {
    const senders = [
      sender({ senderId: 'protected', isProtected: true, inboxCount: 99 }),
      sender({ senderId: 'wrote', wroteToCount: 1, inboxCount: 80 }),
      sender({ senderId: 'keep', isKeep: true, inboxCount: 70 }),
      sender({ senderId: 'no-link', hasUnsubscribe: false, inboxCount: 60 }),
      ...Array.from({ length: T.fixSetCap + 2 }, (_, index) =>
        sender({ senderId: `ok-${String(index).padStart(2, '0')}`, inboxCount: 50 - index }),
      ),
    ];
    const report = selectInboxReport(
      facts({ senders, inbound90: 1000 }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(report.fix.sendersCount).toBe(T.fixSetCap);
    expect(report.fix.senderKeys).not.toContain('protected');
    expect(report.fix.senderKeys).not.toContain('wrote');
    expect(report.fix.senderKeys).not.toContain('keep');
    expect(report.fix.senderKeys).not.toContain('no-link');
    expect(report.fix.senderKeys[0]).toBe('ok-00');
    expect(report.fallbackSenderCount).toBe(T.fixSetCap + 2);
  });

  it('holds years_deep to oldest year at most eight years back', () => {
    const young = selectInboxReport(
      facts({ oldestYear: 2019, olderThan3YearsCount: 10, peopleReceived: 0, top10Count: 40 }),
      '2026-10-11T00:00:00.000Z',
    );
    const old = selectInboxReport(
      facts({ oldestYear: 2018, olderThan3YearsCount: 10, peopleReceived: 0, top10Count: 40 }),
      '2026-10-11T00:00:00.000Z',
    );
    expect(young.insights.some((insight) => insight.id === 'years_deep')).toBe(false);
    expect(old.insights.some((insight) => insight.id === 'years_deep')).toBe(true);
  });
});
