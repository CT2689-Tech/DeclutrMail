// Regression tests for the BE → FE senders adapters.
//
// These pin the wire-contract seam where the BE enum values must match
// the FE literal maps EXACTLY. A drift here (e.g. `'llm'` vs the real
// `'llm_haiku'`, or a dropped protection flag) compiles fine but renders
// blank / mis-buckets in production — these tests catch that class.

import { describe, expect, it } from 'vitest';
import { adaptDecisionHistoryRow, adaptSenderListRow } from './adapters';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  isStandingProtected,
  recommendAction,
} from '../data';
import { intentOf } from '../uplift-d/intent';
import type { DecisionHistoryRowDto, SenderListRow } from '@/lib/api/senders';

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
    monthlyVolume: 12,
    readRate: 0.1,
    volumeTrend: 'steady',
    unsubscribeMethod: 'one_click',
    lastReview: null,
    protectionFlags: {
      isVip: false,
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
  it('surfaces isProtected → Sender.protected and isVip → Sender.isVip', () => {
    const s = adaptSenderListRow(
      listRow({
        protectionFlags: {
          isVip: true,
          isProtected: true,
          protectionReason: 'vip',
          protectionSetAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );
    expect(s.protected).toBe(true);
    expect(s.isVip).toBe(true);
  });

  it('defaults protected/isVip to false when the policy is empty', () => {
    const s = adaptSenderListRow(listRow());
    expect(s.protected).toBe(false);
    expect(s.isVip).toBe(false);
  });

  it('shields a VIP-only sender (isVip && !isProtected) from every destructive action', () => {
    // The real BE sends VIP and Protect independently (D42/D43). A VIP
    // that is not also `isProtected` must STILL be untouchable by bulk
    // actions and route to the Protect bucket — the gap the design gate
    // caught: the surfaces must agree on one `isStandingProtected` predicate.
    const vipOnly = adaptSenderListRow(
      listRow({
        protectionFlags: {
          isVip: true,
          isProtected: false,
          protectionReason: 'vip',
          protectionSetAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );
    expect(vipOnly.isVip).toBe(true);
    expect(vipOnly.protected).toBe(false);
    expect(isStandingProtected(vipOnly)).toBe(true);
    expect(canArchive(vipOnly)).toBe(false);
    expect(canLater(vipOnly)).toBe(false);
    expect(canUnsubscribe(vipOnly)).toBe(false);
    expect(intentOf(vipOnly)).toBe('protect');
    // A VIP must never get a cleanup recommendation either (row-detail callout).
    expect(recommendAction(vipOnly)).toBeNull();
  });

  it('passes the confidence through on lastReview so the intent gate can read it', () => {
    const s = adaptSenderListRow(
      listRow({
        lastReview: {
          at: '2026-05-01T00:00:00.000Z',
          verdict: 'unsubscribe',
          generatedBy: 'llm_haiku',
          confidence: 0.6,
        },
      }),
    );
    expect(s.lastReview?.confidence).toBe(0.6);
  });
});
