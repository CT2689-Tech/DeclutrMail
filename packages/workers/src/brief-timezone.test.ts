import { describe, expect, it } from 'vitest';

import { BRIEF_DEFAULT_HOUR } from '@declutrmail/shared/contracts';

import { resolveBriefLocalWindow, validTimeZoneOrUtc } from './brief-timezone.js';

const AT_8AM = BRIEF_DEFAULT_HOUR;

describe('resolveBriefLocalWindow', () => {
  it('waits until 08:00 in Los Angeles and returns local calendar boundaries', () => {
    const before = resolveBriefLocalWindow(
      new Date('2026-05-25T14:59:59Z'),
      'America/Los_Angeles',
      AT_8AM,
    );
    const ready = resolveBriefLocalWindow(
      new Date('2026-05-25T15:00:00Z'),
      'America/Los_Angeles',
      AT_8AM,
    );

    expect(before.ready).toBe(false);
    expect(ready).toMatchObject({
      ready: true,
      runDateLocal: '2026-05-25',
      timeZone: 'America/Los_Angeles',
    });
    expect(ready.previousDayStart.toISOString()).toBe('2026-05-24T07:00:00.000Z');
    expect(ready.todayStart.toISOString()).toBe('2026-05-25T07:00:00.000Z');
  });

  it('supports half-hour offsets', () => {
    const before = resolveBriefLocalWindow(
      new Date('2026-05-25T02:29:59Z'),
      'Asia/Kolkata',
      AT_8AM,
    );
    const ready = resolveBriefLocalWindow(new Date('2026-05-25T02:30:00Z'), 'Asia/Kolkata', AT_8AM);

    expect(before.ready).toBe(false);
    expect(ready.ready).toBe(true);
    expect(ready.previousDayStart.toISOString()).toBe('2026-05-23T18:30:00.000Z');
    expect(ready.todayStart.toISOString()).toBe('2026-05-24T18:30:00.000Z');
  });

  it('uses the local calendar date rather than the UTC date', () => {
    const fridayInLosAngeles = resolveBriefLocalWindow(
      new Date('2026-05-30T01:00:00Z'),
      'America/Los_Angeles',
      AT_8AM,
    );

    expect(fridayInLosAngeles.runDateLocal).toBe('2026-05-29');
  });

  it('returns an exact 23-hour previous day across spring DST', () => {
    const window = resolveBriefLocalWindow(
      new Date('2026-03-09T15:00:00Z'),
      'America/Los_Angeles',
      AT_8AM,
    );

    expect(window.previousDayStart.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(window.todayStart.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(window.todayStart.getTime() - window.previousDayStart.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('falls back to UTC for missing or invalid zones', () => {
    expect(validTimeZoneOrUtc(null)).toBe('UTC');
    expect(validTimeZoneOrUtc('Mars/Olympus_Mons')).toBe('UTC');

    const window = resolveBriefLocalWindow(new Date('2026-05-25T08:00:00Z'), 'not/a-zone', AT_8AM);
    expect(window).toMatchObject({
      timeZone: 'UTC',
      runDateLocal: '2026-05-25',
      ready: true,
    });
  });

  // — D64: the gate moves with the user's configured hour —

  it('gates on the configured hour, not a fixed 8am', () => {
    // 17:00 local in Los Angeles on 2026-05-25 is 00:00Z on the 26th.
    const at1659 = new Date('2026-05-25T23:59:59Z');
    const at1700 = new Date('2026-05-26T00:00:00Z');

    expect(resolveBriefLocalWindow(at1659, 'America/Los_Angeles', 17).ready).toBe(false);
    expect(resolveBriefLocalWindow(at1700, 'America/Los_Angeles', 17).ready).toBe(true);

    // The same instants are long past a default-8am mailbox's gate —
    // proving the gate follows the preference rather than the clock.
    expect(resolveBriefLocalWindow(at1659, 'America/Los_Angeles', AT_8AM).ready).toBe(true);
  });

  it('is ready from local midnight when the hour is 0', () => {
    const justAfterLocalMidnight = new Date('2026-05-25T07:00:01Z'); // 00:00:01 PDT
    const window = resolveBriefLocalWindow(justAfterLocalMidnight, 'America/Los_Angeles', 0);

    expect(window.ready).toBe(true);
    expect(window.runDateLocal).toBe('2026-05-25');
  });

  it('falls back to 8am for an out-of-range or non-integer hour', () => {
    // A stalled mailbox is the failure mode being prevented: an
    // unclamped 25 gates `ready` false at every hour, forever.
    const at0759 = new Date('2026-05-25T14:59:59Z');
    const at0800 = new Date('2026-05-25T15:00:00Z');

    for (const bogus of [25, -1, 8.5, Number.NaN]) {
      expect(resolveBriefLocalWindow(at0759, 'America/Los_Angeles', bogus).ready).toBe(false);
      expect(resolveBriefLocalWindow(at0800, 'America/Los_Angeles', bogus).ready).toBe(true);
    }
  });
});
