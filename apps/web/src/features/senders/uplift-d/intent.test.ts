// Contract tests for the intent-grouping helper (ADR-0012).
//
// These tests pin the bucketing rules exactly. The rules are derived
// from existing Sender fields, so any change to Sender.lastReview /
// Sender.protected must update both the helper and these tests in the
// same PR. Bucketing precedence: unsubscribe → cleanup; archive →
// later; protected → protect; everything else → people.

import { describe, expect, it } from 'vitest';
import { intentOf, groupByIntent, INTENT_ORDER, ENGINE_CONFIDENCE_GATE } from './intent';
import type { Sender } from '../data';

function senderFixture(overrides: Partial<Sender>): Sender {
  return {
    id: 'fx-' + Math.random().toString(36).slice(2),
    name: 'Fixture',
    domain: 'example.com',
    monthly: 10,
    group: 'updates',
    read: 0.5,
    spark: [1, 2, 3, 4],
    lastDays: 3,
    unread: 1,
    firstSeenMo: 12,
    ...overrides,
  };
}

describe('intentOf — ADR-0012 bucketing rules', () => {
  it('buckets unsubscribe-recommended senders into cleanup', () => {
    const s = senderFixture({
      lastReview: { at: '2026-05-25T00:00:00Z', verdict: 'unsubscribe', generatedBy: 'llm_haiku' },
    });
    expect(intentOf(s)).toBe('cleanup');
  });

  it('buckets archive-recommended senders into later', () => {
    const s = senderFixture({
      lastReview: { at: '2026-05-25T00:00:00Z', verdict: 'archive', generatedBy: 'template' },
    });
    expect(intentOf(s)).toBe('later');
  });

  it('buckets protected senders into protect when no recommendation', () => {
    const s = senderFixture({ protected: true });
    expect(intentOf(s)).toBe('protect');
  });

  it('falls back to people when no recommendation and not protected', () => {
    const s = senderFixture({ protected: false });
    expect(intentOf(s)).toBe('people');
  });

  it('treats keep verdict as people (Keep is the default, not a special bucket)', () => {
    const s = senderFixture({
      lastReview: { at: '2026-05-25T00:00:00Z', verdict: 'keep', generatedBy: 'template' },
    });
    expect(intentOf(s)).toBe('people');
  });

  it('treats later verdict as people (Later is a defer, not a bucket)', () => {
    const s = senderFixture({
      lastReview: { at: '2026-05-25T00:00:00Z', verdict: 'later', generatedBy: 'template' },
    });
    expect(intentOf(s)).toBe('people');
  });

  it('protect wins over engine recommendations (user-pinned policy beats engine)', () => {
    // X2 confidence-gate change: protected senders always bucket as
    // Protect, regardless of engine verdict. User's standing policy
    // is more authoritative than any engine recommendation. Prior
    // ADR-0012 phrasing (cleanup wins over protect) reverted in X2.
    const s = senderFixture({
      protected: true,
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'unsubscribe',
        generatedBy: 'llm_haiku',
        confidence: 0.95,
      },
    });
    expect(intentOf(s)).toBe('protect');
  });
});

describe('intentOf — confidence gate (X2)', () => {
  it('passes high-confidence unsubscribe through to cleanup', () => {
    const s = senderFixture({
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'unsubscribe',
        generatedBy: 'llm_haiku',
        confidence: 0.9,
      },
    });
    expect(intentOf(s)).toBe('cleanup');
  });

  it('suppresses low-confidence unsubscribe — falls back to people catch-all', () => {
    // Phase B insufficient_signal returns 0.70 < gate (0.75). Sender
    // should NOT show up as Cleanup just because engine made a guess.
    const s = senderFixture({
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'unsubscribe',
        generatedBy: 'template',
        confidence: 0.7,
      },
    });
    expect(intentOf(s)).toBe('people');
  });

  it('suppresses low-confidence archive — falls back to people catch-all', () => {
    const s = senderFixture({
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'archive',
        generatedBy: 'template',
        confidence: 0.6,
      },
    });
    expect(intentOf(s)).toBe('people');
  });

  it('passes high-confidence archive through to later', () => {
    const s = senderFixture({
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'archive',
        generatedBy: 'llm_haiku',
        confidence: 0.85,
      },
    });
    expect(intentOf(s)).toBe('later');
  });

  it('defaults missing confidence to 1.0 (backward compatible with older wire payloads)', () => {
    const s = senderFixture({
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'unsubscribe',
        generatedBy: 'llm_haiku',
        // confidence omitted — older wire shape
      },
    });
    expect(intentOf(s)).toBe('cleanup');
  });

  it('exact-threshold confidence (0.75) passes the gate (inclusive boundary)', () => {
    const s = senderFixture({
      lastReview: {
        at: '2026-05-25T00:00:00Z',
        verdict: 'unsubscribe',
        generatedBy: 'template',
        confidence: ENGINE_CONFIDENCE_GATE,
      },
    });
    expect(intentOf(s)).toBe('cleanup');
  });
});

describe('groupByIntent — ADR-0012 grouping order', () => {
  it('returns groups in INTENT_ORDER even when some are empty', () => {
    const single = [senderFixture({ protected: true })];
    const out = groupByIntent(single);
    expect(out.map((b) => b.intent)).toEqual([...INTENT_ORDER]);
  });

  it('places senders into the correct bucket', () => {
    const senders: Sender[] = [
      senderFixture({
        name: 'LinkedIn',
        lastReview: {
          at: '2026-05-25T00:00:00Z',
          verdict: 'unsubscribe',
          generatedBy: 'llm_haiku',
        },
      }),
      senderFixture({
        name: 'Substack',
        lastReview: { at: '2026-05-25T00:00:00Z', verdict: 'archive', generatedBy: 'template' },
      }),
      senderFixture({ name: 'Stripe', protected: true }),
      senderFixture({ name: 'GitHub' }),
    ];
    const out = groupByIntent(senders);
    expect(out.find((b) => b.intent === 'cleanup')?.items.map((s) => s.name)).toEqual(['LinkedIn']);
    expect(out.find((b) => b.intent === 'later')?.items.map((s) => s.name)).toEqual(['Substack']);
    expect(out.find((b) => b.intent === 'protect')?.items.map((s) => s.name)).toEqual(['Stripe']);
    expect(out.find((b) => b.intent === 'people')?.items.map((s) => s.name)).toEqual(['GitHub']);
  });

  it('attaches the IntentMeta to each bucket', () => {
    const out = groupByIntent([]);
    const cleanup = out.find((b) => b.intent === 'cleanup');
    expect(cleanup?.meta.label).toBe('Clean up');
    expect(cleanup?.meta.description).toBe('Senders we think you can let go');
    expect(cleanup?.meta.accent).toBe('amber');
  });
});
