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
    action: 'unsubscribe',
    source: 'manual',
    occurredAt: '2026-05-01T00:00:00.000Z',
    affectedCount: 0,
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

describe('adaptDecisionHistoryRow — actions that actually happened', () => {
  it('names the person who acted, not the engine that scored', () => {
    // Regression (founder screenshot 2026-08-19): this row used to be
    // built from `triage_decisions`, so a sender the user had never
    // touched rendered "Triage Kept · op <uuid>" while Activity — the
    // same facts, read from `activity_log` — showed nothing at all.
    expect(adaptDecisionHistoryRow(historyRow({ source: 'manual' }))?.source).toBe('You');
    expect(adaptDecisionHistoryRow(historyRow({ source: 'autopilot' }))?.source).toBe('Autopilot');
  });

  it('maps every wire action to its past-tense label', () => {
    const cases: Array<[DecisionHistoryRowDto['action'], string]> = [
      ['keep', 'Kept'],
      ['archive', 'Archived'],
      ['unsubscribe', 'Unsubscribe requested'],
      ['later', 'Moved to Later'],
      ['delete', 'Deleted'],
      ['marked_protected', 'Protected'],
      ['unmarked_protected', 'Unprotected'],
    ];
    for (const [action, label] of cases) {
      expect(adaptDecisionHistoryRow(historyRow({ action }))?.action).toBe(label);
    }
  });

  it('carries the real affected count and omits it when nothing moved', () => {
    expect(adaptDecisionHistoryRow(historyRow({ affectedCount: 47 }))?.count).toBe(47);
    // A Keep or a Protect moves no mail — the row must not claim
    // "0 messages", it must say nothing about a count at all.
    expect(adaptDecisionHistoryRow(historyRow({ action: 'keep' }))?.count).toBeUndefined();
  });

  it('uses the occurrence time, not an engine compute time', () => {
    const row = adaptDecisionHistoryRow(historyRow({ occurredAt: '2026-08-18T09:30:00.000Z' }));
    expect(row?.at).toBe('2026-08-18T09:30:00.000Z');
  });

  it('drops a row it cannot describe instead of rendering a blank verb', () => {
    // Reachable while the API runs a version ahead of the web app — the
    // two deploy separately. A half-known row would render an empty verb
    // and an "NaN yr ago" timestamp, asserting an event it can say
    // nothing true about.
    const unknownAction = { ...historyRow(), action: 'teleported' } as unknown as Parameters<
      typeof adaptDecisionHistoryRow
    >[0];
    expect(adaptDecisionHistoryRow(unknownAction)).toBeNull();
    const unknownSource = { ...historyRow(), source: 'poltergeist' } as unknown as Parameters<
      typeof adaptDecisionHistoryRow
    >[0];
    expect(adaptDecisionHistoryRow(unknownSource)).toBeNull();
  });

  it('never produces an undefined source', () => {
    for (const source of ['manual', 'triage', 'autopilot', 'screener'] as const) {
      expect(adaptDecisionHistoryRow(historyRow({ source }))?.source).toBeDefined();
    }
  });
});

describe('adaptSenderDetail — the engine suggestion', () => {
  const DETAIL_REC = {
    verdict: 'keep' as const,
    confidence: 0.88,
    reasoning: 'You read every message from this sender.',
    generatedBy: 'llm_haiku' as const,
    scoredAt: '2026-05-20T10:00:00.000Z',
    stale: false,
  };

  it('passes the engine read through, including when it was scored', () => {
    const detail = adaptSenderDetail({
      detail: { ...makeSenderRow(), recommendation: DETAIL_REC },
      messages: [],
      timeseries: [],
      history: [],
    });
    expect(detail.recommendation).toEqual({
      verdict: 'keep',
      confidence: 0.88,
      reasoning: 'You read every message from this sender.',
      scoredAt: '2026-05-20T10:00:00.000Z',
      stale: false,
      signals: [],
    });
  });

  it('stays silent when the engine has never scored the sender', () => {
    // Explicit null on the wire…
    const withNull = adaptSenderDetail({
      detail: { ...makeSenderRow(), recommendation: null },
      messages: [],
      timeseries: [],
      history: [],
    });
    expect(withNull.recommendation).toBeNull();

    // …and a payload that omits the key entirely (older fixtures, and
    // any response predating the field).
    const withoutKey = adaptSenderDetail({
      detail: makeSenderRow(),
      messages: [],
      timeseries: [],
      history: [],
    });
    expect(withoutKey.recommendation).toBeNull();
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

  it('returns null when protected but the wire omits the reason — never a guess', () => {
    // The old fallback here was `'user-marked'`, which turned an
    // unrecognized enum value into a false statement about the user's
    // own actions ("you marked it Protected") — the exact defect the
    // shared protection copy module was built to end, alive one adapter
    // upstream of it. Consumers render "Protected" with no evidence
    // clause for this shape.
    expect(adaptProtectionReason(true, null)).toBeNull();
  });

  it('returns null for an enum value this build does not know', () => {
    expect(
      adaptProtectionReason(
        true,
        'some_future_reason' as unknown as Parameters<typeof adaptProtectionReason>[1],
      ),
    ).toBeNull();
  });

  it('hides the retained memory-pin reason after manual Unprotect', () => {
    expect(adaptProtectionReason(false, 'replied')).toBeNull();
  });
});

describe('adaptSenderDetail — honest wire composition', () => {
  const NOW = Date.parse('2026-06-01T00:00:00.000Z');

  it('maps the real wire category and never synthesizes a recommendation', () => {
    // These facts would make the old fixture builder synthesize a
    // recommendation. The DTO carries `recommendation` now, but only
    // when the engine actually scored the sender — absent means
    // unscored, and the adapter must return null rather than inventing
    // product data from the facts it can see.
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

  it('rides wroteToCount through to the sender model (the old adapter dropped it)', () => {
    const detail = adaptSenderDetail({
      detail: makeSenderRow({ wroteToCount: 7 }),
      messages: [],
      timeseries: [],
      history: [],
      now: NOW,
    });
    expect(detail.sender.wroteToCount).toBe(7);
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
