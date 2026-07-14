// Regression tests for the BE → FE senders adapters.
//
// These pin the wire-contract seam where the BE enum values must match
// the FE literal maps EXACTLY. A drift here (e.g. `'llm'` vs the real
// `'llm_haiku'`, or a dropped protection flag) compiles fine but renders
// blank / mis-buckets in production — these tests catch that class.

import { describe, expect, it } from 'vitest';
import { adaptDecisionHistoryRow, adaptSenderDetail, adaptSenderListRow } from './adapters';
import { canArchive, canLater, canUnsubscribe, isStandingProtected } from '../data';
import { derivePrimaryVerbId } from '../action-row';
import type { DecisionHistoryRowDto, SenderDetailDto, SenderListRow } from '@/lib/api/senders';

function listRow(overrides: Partial<SenderListRow> = {}): SenderListRow {
  return {
    id: 's1',
    displayName: 'Acme',
    email: 'hello@acme.com',
    domain: 'acme.com',
    gmailCategory: 'promotions',
    firstSeenAt: '2025-01-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    totalReceived: 144,
    repliedCount: 0,
    monthlyVolume: 12,
    readRate: 0.1,
    volumeTrend: 'steady',
    unsubscribeMethod: 'one_click',
    lastReview: null,
    protectionFlags: {
      isProtected: false,
      protectionReason: null,
      protectionSetAt: null,
    },
    ...overrides,
  };
}

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

function detailRow(overrides: Partial<SenderDetailDto> = {}): SenderDetailDto {
  return { ...listRow(), ...overrides };
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

  it('never produces an undefined source', () => {
    for (const generatedBy of ['llm_haiku', 'template'] as const) {
      expect(adaptDecisionHistoryRow(historyRow({ generatedBy })).source).toBeDefined();
    }
  });
});

describe('adaptSenderListRow — protection flags (D42/D43)', () => {
  it('surfaces isProtected → Sender.protected', () => {
    const s = adaptSenderListRow(
      listRow({
        protectionFlags: {
          isProtected: true,
          protectionReason: 'user_defined',
          protectionSetAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );
    expect(s.protected).toBe(true);
  });

  it('defaults protected to false when the policy is empty', () => {
    const s = adaptSenderListRow(listRow());
    expect(s.protected).toBe(false);
  });

  it('carries unsubscribeMethod through so the row can derive unsub-ready (ADR-0019)', () => {
    // Regression: the adapter used to drop this field, leaving the
    // action row's `unsub_ready` fact permanently false — the primary
    // CTA could never derive Unsubscribe from the wire.
    expect(adaptSenderListRow(listRow({ unsubscribeMethod: 'one_click' })).unsubscribeMethod).toBe(
      'one_click',
    );
    expect(adaptSenderListRow(listRow({ unsubscribeMethod: 'mailto' })).unsubscribeMethod).toBe(
      'mailto',
    );
    expect(adaptSenderListRow(listRow({ unsubscribeMethod: null })).unsubscribeMethod).toBeNull();
  });

  it('carries the REAL total_received to Sender.total — never monthly × 12', () => {
    // Regression guard for the fabrication removal: `total` must be the
    // factual all-time count, not the old `monthly × 12` synthesis (which
    // would have produced 36 here, not 144).
    const s = adaptSenderListRow(listRow({ totalReceived: 144, monthlyVolume: 3 }));
    expect(s.total).toBe(144);
  });

  it('shields a Protected sender from every destructive action', () => {
    const protectedSender = adaptSenderListRow(
      listRow({
        protectionFlags: {
          isProtected: true,
          protectionReason: 'user_defined',
          protectionSetAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );
    expect(protectedSender.protected).toBe(true);
    expect(isStandingProtected(protectedSender)).toBe(true);
    expect(canArchive(protectedSender)).toBe(false);
    expect(canLater(protectedSender)).toBe(false);
    expect(canUnsubscribe(protectedSender)).toBe(false);
    expect(derivePrimaryVerbId(protectedSender)).toBe('keep');
  });

  it('retains confidence as review metadata without using it for the primary action', () => {
    const s = adaptSenderListRow(
      listRow({
        unsubscribeMethod: 'none',
        lastReview: {
          at: '2026-05-01T00:00:00.000Z',
          verdict: 'unsubscribe',
          generatedBy: 'llm_haiku',
          confidence: 0.6,
        },
      }),
    );
    expect(s.lastReview?.confidence).toBe(0.6);
    expect(derivePrimaryVerbId(s)).toBe('keep');
  });
});

describe('adaptSenderDetail — live data never falls back to fixtures', () => {
  it('maps the real wire category and withholds recommendations absent from the contract', () => {
    // These facts would make the old fixture builder synthesize a
    // recommendation. The live DTO does not carry one, so the adapter
    // must return null rather than presenting invented product data.
    const detail = adaptSenderDetail({
      detail: detailRow({
        gmailCategory: 'social',
        monthlyVolume: 40,
        readRate: 0,
      }),
      messages: [],
      timeseries: [],
      history: [],
      now: new Date('2026-06-01T00:00:00.000Z').getTime(),
    });

    expect(detail.gmailCategory).toBe('Gmail: Social');
    expect(detail.recommendation).toBeNull();
    expect(detail.recentMessages).toEqual([]);
    expect(detail.timeseries).toEqual([]);
    expect(detail.history).toEqual([]);
  });
});
