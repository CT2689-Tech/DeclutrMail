import { describe, expect, it } from 'vitest';

import type { SnoozedSenderRow } from '@/lib/api/snoozed';

import { formatWakeTime, groupByWakeTime, snoozePresets, wakeBucket } from './snooze-times';

// A Thursday morning, local time.
const NOW = new Date(2026, 5, 11, 8, 0, 0); // 2026-06-11 08:00 local (Thu)

function row(overrides: Partial<SnoozedSenderRow>): SnoozedSenderRow {
  return {
    senderId: 'id',
    displayName: 'Sender',
    email: 's@x.example',
    domain: 'x.example',
    laterCount: 1,
    snoozedUntil: new Date(2026, 5, 11, 17, 0).toISOString(),
    snoozedAt: null,
    reason: null,
    ...overrides,
  };
}

describe('wakeBucket (D80)', () => {
  it('buckets every required wake time', () => {
    expect(wakeBucket(new Date(2026, 5, 11, 17, 0).toISOString(), NOW)).toBe('today');
    expect(wakeBucket(new Date(2026, 5, 12, 9, 0).toISOString(), NOW)).toBe('tomorrow');
    expect(wakeBucket(new Date(2026, 5, 15, 9, 0).toISOString(), NOW)).toBe('week');
    expect(wakeBucket(new Date(2026, 6, 1, 9, 0).toISOString(), NOW)).toBe('eventually');
  });

  it('rejects an invalid server wake time instead of inventing a repair bucket', () => {
    expect(() => wakeBucket('not-a-time', NOW)).toThrow('Invalid Later wake time.');
  });

  it('day 7 boundary belongs to eventually', () => {
    expect(wakeBucket(new Date(2026, 5, 17, 23, 0).toISOString(), NOW)).toBe('week');
    expect(wakeBucket(new Date(2026, 5, 18, 0, 0).toISOString(), NOW)).toBe('eventually');
  });
});

describe('groupByWakeTime', () => {
  it('routes every row into exactly one bucket', () => {
    const rows = [
      row({ senderId: '1', snoozedUntil: new Date(2026, 5, 11, 17, 0).toISOString() }),
      row({ senderId: '2', snoozedUntil: new Date(2026, 5, 12, 9, 0).toISOString() }),
    ];
    const grouped = groupByWakeTime(rows, NOW);
    expect(grouped.today.map((r) => r.senderId)).toEqual(['1']);
    expect(grouped.tomorrow.map((r) => r.senderId)).toEqual(['2']);
  });
});

describe('formatWakeTime (D80)', () => {
  it('renders Today / Tomorrow / weekday / date forms', () => {
    expect(formatWakeTime(new Date(2026, 5, 11, 17, 0).toISOString(), NOW)).toMatch(/^Today /);
    expect(formatWakeTime(new Date(2026, 5, 12, 9, 0).toISOString(), NOW)).toMatch(/^Tomorrow /);
    expect(formatWakeTime(new Date(2026, 5, 15, 9, 0).toISOString(), NOW)).toMatch(/^Mon /);
    expect(formatWakeTime(new Date(2026, 6, 1, 9, 0).toISOString(), NOW)).toMatch(/Jul/);
  });
});

describe('snoozePresets (D82)', () => {
  it('every preset resolves to a FUTURE wake time', () => {
    for (const preset of snoozePresets(NOW)) {
      expect(preset.at.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('includes Later today (5 PM) only while 5 PM is still ahead', () => {
    const morning = snoozePresets(NOW);
    expect(morning.some((p) => p.id === 'later_today')).toBe(true);

    const evening = snoozePresets(new Date(2026, 5, 11, 18, 0, 0));
    expect(evening.some((p) => p.id === 'later_today')).toBe(false);
  });

  it('weekend lands on a Saturday 9 AM, next_week on a Monday 9 AM', () => {
    const presets = snoozePresets(NOW);
    const weekend = presets.find((p) => p.id === 'weekend')!;
    expect(weekend.at.getDay()).toBe(6);
    expect(weekend.at.getHours()).toBe(9);
    const nextWeek = presets.find((p) => p.id === 'next_week')!;
    expect(nextWeek.at.getDay()).toBe(1);
    expect(nextWeek.at.getHours()).toBe(9);
  });

  it('next_month is the 1st at 9 AM', () => {
    const preset = snoozePresets(NOW).find((p) => p.id === 'next_month')!;
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
