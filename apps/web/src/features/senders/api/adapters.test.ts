// Regression tests for the BE → FE senders adapters.
//
// These pin the wire-contract seam where the BE enum values must match
// the FE literal maps EXACTLY. A drift here (e.g. `'llm'` vs the real
// `'llm_haiku'`, or a dropped protection flag) compiles fine but renders
// blank / mis-buckets in production — these tests catch that class.
//
// The list-row adapter is GONE (2026-07-16 wire unification):
// `enrichSenderRow` spreads the wire row, covered by
// `../data.test.ts`. What remains here is the Sender Detail
// composition + the small per-row adapters it folds in.

import { describe, expect, it } from 'vitest';
import type { DecisionHistoryRowDto, MailMessageRow, TimeseriesPointDto } from '@/lib/api/senders';
import { makeSenderRow } from '../testing/make-sender';
import {
  adaptDecisionHistoryRow,
  adaptMailMessageRow,
  adaptProtectionReason,
  adaptSenderDetail,
  adaptTimeseriesPoint,
} from './adapters';

function historyRow(overrides: Partial<DecisionHistoryRowDto> = {}): DecisionHistoryRowDto {
  return {
    id: 'd1',
    verdict: 'unsubscribe',
    confidence: 0.92,
    producedAt: '2026-05-01T00:00:00.000Z',
    reasoning: 'High volume, low read rate.',
    generatedBy: 'llm_haiku',
    ...overrides,
  };
}

function messageRow(overrides: Partial<MailMessageRow> = {}): MailMessageRow {
  return {
    id: 'm1',
    providerMessageId: 'prov-m1',
    providerThreadId: 'thread-m1',
    subject: 'Your statement is ready',
    snippet: 'Charges totaled $42.18 across 3 transactions.',
    internalDate: '2026-06-20T10:00:00.000Z',
    isUnread: true,
    sizeBytes: 8742,
    ...overrides,
  };
}

describe('adaptDecisionHistoryRow — provenance label (generatedBy)', () => {
  it('maps llm_haiku → "Triage" (the BE enum value, not "llm")', () => {
    // Regression: the wire type once said `'llm'` while the BE sends
    // `'llm_haiku'`, so the source label rendered blank for every
    // LLM-generated decision on the Sender Detail timeline.
    const row = adaptDecisionHistoryRow(historyRow({ generatedBy: 'llm_haiku' }));
    expect(row.source).toBe('Triage');
  });

  it('maps template → "System"', () => {
    const row = adaptDecisionHistoryRow(historyRow({ generatedBy: 'template' }));
    expect(row.source).toBe('System');
  });

  it('maps every verdict to its past-tense action label', () => {
    expect(adaptDecisionHistoryRow(historyRow({ verdict: 'keep' })).action).toBe('Kept');
    expect(adaptDecisionHistoryRow(historyRow({ verdict: 'archive' })).action).toBe('Archived');
    expect(adaptDecisionHistoryRow(historyRow({ verdict: 'unsubscribe' })).action).toBe(
      'Unsubscribe requested',
    );
    expect(adaptDecisionHistoryRow(historyRow({ verdict: 'later' })).action).toBe('Moved to Later');
  });

  it('never produces an undefined source', () => {
    for (const generatedBy of ['llm_haiku', 'template'] as const) {
      expect(adaptDecisionHistoryRow(historyRow({ generatedBy })).source).toBeDefined();
    }
  });
});

describe('adaptMailMessageRow — recent-message projection', () => {
  it('maps the wire fields onto the FE row (thread id, unread flag, received-at)', () => {
    const row = adaptMailMessageRow(messageRow());
    expect(row).toEqual({
      id: 'm1',
      providerMessageId: 'prov-m1',
      threadId: 'thread-m1',
      subject: 'Your statement is ready',
      snippet: 'Charges totaled $42.18 across 3 transactions.',
      receivedAt: '2026-06-20T10:00:00.000Z',
      sizeBytes: 8742,
      hasAttachment: false,
      unread: true,
    });
  });

  it('forwards a null sizeBytes verbatim — the renderer owns the em-dash', () => {
    expect(adaptMailMessageRow(messageRow({ sizeBytes: null })).sizeBytes).toBeNull();
  });
});

describe('adaptTimeseriesPoint — readCount → opens', () => {
  it('maps the wire point onto the FE chart point', () => {
    expect(adaptTimeseriesPoint({ yearMonth: '2026-06-01', volume: 20, readCount: 3 })).toEqual({
      yearMonth: '2026-06-01',
      volume: 20,
      opens: 3,
    });
  });
});

describe('adaptProtectionReason — explainable automatic protection', () => {
  it.each([
    ['user_defined', 'user-marked'],
    ['replied', 'replied'],
    ['starred', 'starred'],
    ['gmail_important', 'gmail-important'],
  ] as const)('maps %s to %s', (wire, expected) => {
    expect(adaptProtectionReason(true, wire)).toBe(expected);
  });

  it('falls back to user-marked when protected but the wire omits the reason', () => {
    expect(adaptProtectionReason(true, null)).toBe('user-marked');
  });

  it('hides the retained memory-pin reason after manual Unprotect', () => {
    expect(adaptProtectionReason(false, 'replied')).toBeNull();
  });
});

describe('adaptSenderDetail — honest wire composition', () => {
  const NOW = Date.parse('2026-06-01T00:00:00.000Z');

  it('maps the real wire category and withholds recommendations absent from the contract', () => {
    // These facts would make the old fixture builder synthesize a
    // recommendation. The live DTO does not carry one, so the adapter
    // must return null rather than presenting invented product data.
    const detail = adaptSenderDetail({
      detail: makeSenderRow({ gmailCategory: 'social', monthlyVolume: 40, readRate: 0 }),
      messages: [],
      timeseries: [],
      history: [],
      now: NOW,
    });

    expect(detail.gmailCategory).toBe('Gmail: Social');
    expect(detail.recommendation).toBeNull();
    expect(detail.recentMessages).toEqual([]);
    expect(detail.timeseries).toEqual([]);
    expect(detail.history).toEqual([]);
  });

  it('preserves readRate: null — "we don\'t know" never becomes 0%', () => {
    const detail = adaptSenderDetail({
      detail: makeSenderRow({ readRate: null }),
      messages: [],
      timeseries: [],
      history: [],
      now: NOW,
    });
    expect(detail.stats.readRate).toBeNull();
    expect(detail.sender.readRate).toBeNull();
  });

  it('rides repliedCount through to the sender model (the old adapter dropped it)', () => {
    const detail = adaptSenderDetail({
      detail: makeSenderRow({ repliedCount: 7 }),
      messages: [],
      timeseries: [],
      history: [],
      now: NOW,
    });
    expect(detail.sender.repliedCount).toBe(7);
  });

  it('surfaces the protection flags through the reason mapping', () => {
    const detail = adaptSenderDetail({
      detail: makeSenderRow({
        protectionFlags: {
          isProtected: true,
          protectionReason: 'gmail_important',
          protectionSetAt: '2026-04-01T00:00:00.000Z',
        },
      }),
      messages: [],
      timeseries: [],
      history: [],
      now: NOW,
    });
    expect(detail.isProtected).toBe(true);
    expect(detail.protectionReason).toBe('gmail-important');
    expect(detail.sender.protectionFlags.isProtected).toBe(true);
  });

  it('folds the child responses through the per-row adapters', () => {
    const detail = adaptSenderDetail({
      detail: makeSenderRow(),
      messages: [messageRow()],
      timeseries: [{ yearMonth: '2026-05-01', volume: 8, readCount: 2 } as TimeseriesPointDto],
      history: [historyRow()],
      now: NOW,
    });
    expect(detail.recentMessages[0]?.threadId).toBe('thread-m1');
    expect(detail.timeseries[0]?.opens).toBe(2);
    expect(detail.history[0]?.action).toBe('Unsubscribe requested');
  });
});
