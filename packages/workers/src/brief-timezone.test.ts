import { describe, expect, it } from 'vitest';

import { resolveBriefLocalWindow, validTimeZoneOrUtc } from './brief-timezone.js';

describe('resolveBriefLocalWindow', () => {
  it('waits until 08:00 in Los Angeles and returns local calendar boundaries', () => {
    const before = resolveBriefLocalWindow(new Date('2026-05-25T14:59:59Z'), 'America/Los_Angeles');
    const ready = resolveBriefLocalWindow(new Date('2026-05-25T15:00:00Z'), 'America/Los_Angeles');

    expect(before.ready).toBe(false);
    expect(ready).toMatchObject({
      ready: true,
      runDateLocal: '2026-05-25',
      weekend: false,
      timeZone: 'America/Los_Angeles',
    });
    expect(ready.previousDayStart.toISOString()).toBe('2026-05-24T07:00:00.000Z');
    expect(ready.todayStart.toISOString()).toBe('2026-05-25T07:00:00.000Z');
  });

  it('supports half-hour offsets', () => {
    const before = resolveBriefLocalWindow(new Date('2026-05-25T02:29:59Z'), 'Asia/Kolkata');
    const ready = resolveBriefLocalWindow(new Date('2026-05-25T02:30:00Z'), 'Asia/Kolkata');

    expect(before.ready).toBe(false);
    expect(ready.ready).toBe(true);
    expect(ready.previousDayStart.toISOString()).toBe('2026-05-23T18:30:00.000Z');
    expect(ready.todayStart.toISOString()).toBe('2026-05-24T18:30:00.000Z');
  });

  it('uses the local weekday rather than the UTC weekday', () => {
    const fridayInLosAngeles = resolveBriefLocalWindow(
      new Date('2026-05-30T01:00:00Z'),
      'America/Los_Angeles',
    );

    expect(fridayInLosAngeles.runDateLocal).toBe('2026-05-29');
    expect(fridayInLosAngeles.weekend).toBe(false);
  });

  it('returns an exact 23-hour previous day across spring DST', () => {
    const window = resolveBriefLocalWindow(new Date('2026-03-09T15:00:00Z'), 'America/Los_Angeles');

    expect(window.previousDayStart.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(window.todayStart.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(window.todayStart.getTime() - window.previousDayStart.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('falls back to UTC for missing or invalid zones', () => {
    expect(validTimeZoneOrUtc(null)).toBe('UTC');
    expect(validTimeZoneOrUtc('Mars/Olympus_Mons')).toBe('UTC');

    const window = resolveBriefLocalWindow(new Date('2026-05-25T08:00:00Z'), 'not/a-zone');
    expect(window).toMatchObject({
      timeZone: 'UTC',
      runDateLocal: '2026-05-25',
      ready: true,
    });
  });
});
