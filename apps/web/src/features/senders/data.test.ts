// Pins the 2026-07-16 wire-unification contract: `enrichSenderRow` is a
// SPREAD over the wire row plus three derived fields — every wire field
// rides through verbatim (no silent drops like the old adapter's
// `wroteToCount`, no null-coercions like `readRate: null` → 0).

import { describe, expect, it } from 'vitest';
import type { SenderListRow } from '@/lib/api/senders';
import { daysSince, enrichSenderRow, monthsSince } from './data';
import { makeSenderRow } from './testing/make-sender';

const NOW = Date.parse('2026-07-01T00:00:00.000Z');
const UTC = 'UTC';
const LA = 'America/Los_Angeles';

describe('enrichSenderRow — spread totality', () => {
  it('carries EVERY own key of a fully-populated wire row through with identical values', () => {
    // Populate every field — including the optional/nullable ones —
    // so a future hand-mapping regression that drops a field fails here.
    const row = makeSenderRow({
      readRate: 0.42,
      monthlyVolume: 17,
      wroteToCount: 5,
      sparkline: [1, 2, 3, 4],
      volumeTrend: 'up',
      unsubscribeMethod: 'one_click',
      lastReview: {
        at: '2026-06-01T00:00:00.000Z',
        verdict: 'archive',
        generatedBy: 'llm_haiku',
        confidence: 0.9,
      },
      protectionFlags: {
        isProtected: true,
        protectionReason: 'replied',
        protectionSetAt: '2026-05-01T00:00:00.000Z',
      },
      policyType: 'unsubscribe',
      unsubStatus: 'requested',
    });

    const sender = enrichSenderRow(row, NOW, UTC);
    for (const key of Object.keys(row) as (keyof SenderListRow)[]) {
      expect(sender[key], `wire field "${key}" must ride through the enrich`).toEqual(row[key]);
    }
  });

  it('preserves nullable wire facts as null — never coerces to a fake fact', () => {
    const sender = enrichSenderRow(
      makeSenderRow({ readRate: null, monthlyVolume: null, sparkline: null, volumeTrend: null }),
      NOW,
      UTC,
    );
    expect(sender.readRate).toBeNull();
    expect(sender.monthlyVolume).toBeNull();
    expect(sender.sparkline).toBeNull();
    expect(sender.volumeTrend).toBeNull();
  });
});

describe('enrichSenderRow — derived fields', () => {
  it('name falls back displayName || email', () => {
    expect(enrichSenderRow(makeSenderRow({ displayName: 'Acme' }), NOW, UTC).name).toBe('Acme');
    expect(enrichSenderRow(makeSenderRow({ displayName: '' }), NOW, UTC).name).toBe(
      'news@acme.com',
    );
  });

  it('derives lastDays / firstSeenMo from the ISO dates against the given now', () => {
    const sender = enrichSenderRow(
      makeSenderRow({
        lastSeenAt: '2026-06-29T00:00:00.000Z', // 2 days before NOW
        firstSeenAt: '2025-07-06T00:00:00.000Z', // 360 days = 12 × 30d months
      }),
      NOW,
      UTC,
    );
    expect(sender.lastDays).toBe(2);
    expect(sender.firstSeenMo).toBe(12);
  });

  it('clamps future dates to 0', () => {
    const sender = enrichSenderRow(
      makeSenderRow({
        lastSeenAt: '2026-07-02T00:00:00.000Z',
        firstSeenAt: '2026-08-01T00:00:00.000Z',
      }),
      NOW,
      UTC,
    );
    expect(sender.lastDays).toBe(0);
    expect(sender.firstSeenMo).toBe(0);
  });

  it('maps invalid ISO dates to 0 rather than NaN', () => {
    const sender = enrichSenderRow(
      makeSenderRow({ lastSeenAt: 'not-a-date', firstSeenAt: '' }),
      NOW,
      UTC,
    );
    expect(sender.lastDays).toBe(0);
    expect(sender.firstSeenMo).toBe(0);
    expect(daysSince('not-a-date', NOW, UTC)).toBe(0);
    expect(monthsSince('not-a-date', NOW)).toBe(0);
  });
});

describe('daysSince — zone-explicit calendar days (DECLUTRMAIL-WEB-2C)', () => {
  // 2026-07-01T08:00Z is 01:00 PDT. A message from 2026-07-01T02:00Z is
  // still 1 July in UTC and still 30 June in America/Los_Angeles — the
  // SSR-UTC vs US-browser split that hydrated "today" against "1d".
  const now = Date.parse('2026-07-01T08:00:00.000Z');
  const yesterdayInLa = '2026-07-01T02:00:00.000Z';
  const sameDayBothZones = '2026-07-01T16:00:00.000Z';

  it('UTC and America/Los_Angeles can disagree on the same instant', () => {
    expect(daysSince(yesterdayInLa, now, UTC)).toBe(0);
    expect(daysSince(yesterdayInLa, now, LA)).toBe(1);
  });

  it('the same named zone agrees with itself', () => {
    expect(daysSince(yesterdayInLa, now, UTC)).toBe(daysSince(yesterdayInLa, now, UTC));
    expect(daysSince(yesterdayInLa, now, LA)).toBe(daysSince(yesterdayInLa, now, LA));
    expect(daysSince(sameDayBothZones, now, UTC)).toBe(0);
    expect(daysSince(sameDayBothZones, now, LA)).toBe(0);
  });

  it('enrichSenderRow lastDays follows the zone it is given', () => {
    const row = makeSenderRow({ lastSeenAt: yesterdayInLa });
    expect(enrichSenderRow(row, now, UTC).lastDays).toBe(0);
    expect(enrichSenderRow(row, now, LA).lastDays).toBe(1);
  });

  it('falls back to UTC when the IANA id is invalid', () => {
    expect(daysSince(yesterdayInLa, now, 'Not/AZone')).toBe(daysSince(yesterdayInLa, now, UTC));
  });
});
