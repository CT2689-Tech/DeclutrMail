import { describe, expect, it } from 'vitest';

import type { SnoozedSenderRow } from '@/lib/api/snoozed';

import { formatWakeTime, groupByWakeTime, snoozePresets, wakeBucket } from './snooze-times';

// A Thursday morning in the user's zone: 2026-06-11 08:00 IST.
// Fixed INSTANT + explicit IANA zone so every assertion is an exact
// string, independent of the machine's locale and TZ (the labels are
// server-rendered into hydrated HTML — see e2e hydration-smoke).
const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-06-11T08:00:00+05:30');

function row(overrides: Partial<SnoozedSenderRow>): SnoozedSenderRow {
  return {
    senderId: 'id',
    displayName: 'Sender',
    email: 's@x.example',
    domain: 'x.example',
    laterCount: 1,
    snoozedUntil: '2026-06-11T17:00:00+05:30',
    snoozedAt: null,
    reason: null,
    returnStatus: 'scheduled',
    lastReturnAttemptAt: null,
    returnFailureKind: null,
    ...overrides,
  };
}

describe('wakeBucket (D80)', () => {
  it('buckets every required wake time', () => {
    expect(wakeBucket('2026-06-11T17:00:00+05:30', NOW, TZ)).toBe('today');
    expect(wakeBucket('2026-06-12T09:00:00+05:30', NOW, TZ)).toBe('tomorrow');
    expect(wakeBucket('2026-06-15T09:00:00+05:30', NOW, TZ)).toBe('week');
    expect(wakeBucket('2026-07-01T09:00:00+05:30', NOW, TZ)).toBe('eventually');
  });

  it('rejects an invalid server wake time instead of inventing a repair bucket', () => {
    expect(() => wakeBucket('not-a-time', NOW, TZ)).toThrow('Invalid Later return time.');
  });

  it('day 7 boundary belongs to eventually', () => {
    expect(wakeBucket('2026-06-17T23:00:00+05:30', NOW, TZ)).toBe('week');
    expect(wakeBucket('2026-06-18T00:00:00+05:30', NOW, TZ)).toBe('eventually');
  });

  it('the zone decides the calendar day, not the process TZ', () => {
    // 20:00 UTC is still Thu Jun 11 in UTC, but already Fri Jun 12
    // 01:30 in IST — the SAME instant lands in different buckets
    // depending on the user zone, and in the SAME bucket regardless of
    // the machine running this test.
    const instant = '2026-06-11T20:00:00Z';
    expect(wakeBucket(instant, NOW, TZ)).toBe('tomorrow');
    expect(wakeBucket(instant, NOW, 'UTC')).toBe('today');
  });
});

describe('groupByWakeTime', () => {
  it('routes every row into exactly one bucket', () => {
    const rows = [
      row({ senderId: '1', snoozedUntil: '2026-06-11T17:00:00+05:30' }),
      row({ senderId: '2', snoozedUntil: '2026-06-12T09:00:00+05:30' }),
    ];
    const grouped = groupByWakeTime(rows, NOW, TZ);
    expect(grouped.today.map((r) => r.senderId)).toEqual(['1']);
    expect(grouped.tomorrow.map((r) => r.senderId)).toEqual(['2']);
  });
});

describe('formatWakeTime (D80)', () => {
  it('renders exact Today / Tomorrow / weekday / date labels', () => {
    expect(formatWakeTime('2026-06-11T17:00:00+05:30', NOW, TZ)).toBe('Today 5:00 PM');
    expect(formatWakeTime('2026-06-12T09:00:00+05:30', NOW, TZ)).toBe('Tomorrow 9:00 AM');
    expect(formatWakeTime('2026-06-15T09:00:00+05:30', NOW, TZ)).toBe('Mon 9:00 AM');
    expect(formatWakeTime('2026-07-01T09:00:00+05:30', NOW, TZ)).toBe('Jul 1');
  });

  it('renders the same instant per zone, never per machine', () => {
    const instant = '2026-06-11T20:00:00Z';
    expect(formatWakeTime(instant, NOW, TZ)).toBe('Tomorrow 1:30 AM');
    expect(formatWakeTime(instant, NOW, 'UTC')).toBe('Today 8:00 PM');
  });
});

describe('snoozePresets (D82)', () => {
  // Presets are created in the USER zone (same zone the /later rows
  // display in), never the machine/browser zone — otherwise "Later
  // today (5:00 PM)" could save an instant the row then renders as
  // "Today 7:30 PM". Exact ISO instants prove the wall times.
  const at = (presets: ReturnType<typeof snoozePresets>, id: string) =>
    presets.find((p) => p.id === id)!.at.toISOString();

  it('resolves every wall time in the given zone (exact instants)', () => {
    const presets = snoozePresets(NOW, TZ); // Thu 2026-06-11 08:00 IST
    expect(at(presets, 'later_today')).toBe('2026-06-11T11:30:00.000Z'); // 17:00 IST
    expect(at(presets, 'tomorrow')).toBe('2026-06-12T03:30:00.000Z'); // Fri 09:00 IST
    expect(at(presets, 'weekend')).toBe('2026-06-13T03:30:00.000Z'); // Sat 09:00 IST
    expect(at(presets, 'next_week')).toBe('2026-06-15T03:30:00.000Z'); // Mon 09:00 IST
    expect(at(presets, 'next_month')).toBe('2026-07-01T03:30:00.000Z'); // Jul 1 09:00 IST
  });

  it('every preset resolves to a FUTURE wake time', () => {
    for (const preset of snoozePresets(NOW, TZ)) {
      expect(preset.at.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('the zone decides whether Later today is still ahead, not the machine', () => {
    // 13:00 UTC = 18:30 IST: 5 PM has passed in IST but not in UTC —
    // the SAME instant includes the preset in one zone and not the other.
    const now = new Date('2026-06-11T13:00:00Z');
    expect(snoozePresets(now, TZ).some((p) => p.id === 'later_today')).toBe(false);
    const utc = snoozePresets(now, 'UTC');
    expect(utc.some((p) => p.id === 'later_today')).toBe(true);
    expect(at(utc, 'later_today')).toBe('2026-06-11T17:00:00.000Z');
  });

  it('lands on the wall clock across a DST transition', () => {
    // Sat 2026-03-07 12:00 EST; US DST starts Sun 2026-03-08. Tomorrow
    // 9 AM must be 09:00 EDT (-04), not a naive +24h from EST (-05).
    const now = new Date('2026-03-07T12:00:00-05:00');
    const presets = snoozePresets(now, 'America/New_York');
    expect(at(presets, 'tomorrow')).toBe('2026-03-08T13:00:00.000Z');
  });

  it('on a Saturday, weekend points at the NEXT Saturday', () => {
    const saturday = new Date('2026-06-13T10:00:00+05:30'); // Sat IST morning
    const presets = snoozePresets(saturday, TZ);
    expect(at(presets, 'weekend')).toBe('2026-06-20T03:30:00.000Z'); // Sat Jun 20 09:00 IST
  });

  it('next_month rolls the year over from December', () => {
    const december = new Date('2026-12-10T08:00:00+05:30');
    expect(at(snoozePresets(december, TZ), 'next_month')).toBe('2027-01-01T03:30:00.000Z');
  });
});
