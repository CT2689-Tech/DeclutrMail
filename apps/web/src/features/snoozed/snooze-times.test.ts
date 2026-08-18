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
    expect(() => wakeBucket('not-a-time', NOW, TZ)).toThrow('Invalid Later wake time.');
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
  it('every preset resolves to a FUTURE wake time', () => {
    for (const preset of snoozePresets(NOW)) {
      expect(preset.at.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('includes Later today (5 PM) only while 5 PM is still ahead', () => {
    const morning = snoozePresets(new Date(2026, 5, 11, 8, 0, 0));
    expect(morning.some((p) => p.id === 'later_today')).toBe(true);

    const evening = snoozePresets(new Date(2026, 5, 11, 18, 0, 0));
    expect(evening.some((p) => p.id === 'later_today')).toBe(false);
  });

  it('weekend lands on a Saturday 9 AM, next_week on a Monday 9 AM', () => {
    const presets = snoozePresets(new Date(2026, 5, 11, 8, 0, 0));
    const weekend = presets.find((p) => p.id === 'weekend')!;
    expect(weekend.at.getDay()).toBe(6);
    expect(weekend.at.getHours()).toBe(9);
    const nextWeek = presets.find((p) => p.id === 'next_week')!;
    expect(nextWeek.at.getDay()).toBe(1);
    expect(nextWeek.at.getHours()).toBe(9);
  });

  it('next_month is the 1st at 9 AM', () => {
    const preset = snoozePresets(new Date(2026, 5, 11, 8, 0, 0)).find(
      (p) => p.id === 'next_month',
    )!;
    expect(preset.at.getDate()).toBe(1);
    expect(preset.at.getMonth()).toBe(6); // July
    expect(preset.at.getHours()).toBe(9);
  });

  it('on a Saturday, weekend points at the NEXT Saturday', () => {
    const saturday = new Date(2026, 5, 13, 10, 0, 0); // Sat 2026-06-13
    const weekend = snoozePresets(saturday).find((p) => p.id === 'weekend')!;
    expect(weekend.at.getDay()).toBe(6);
    expect(weekend.at.getTime()).toBeGreaterThan(saturday.getTime());
  });
});
