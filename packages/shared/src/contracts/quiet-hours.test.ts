import { describe, expect, it } from 'vitest';

import {
  isValidTimeZone,
  isWithinQuietWindow,
  minutesOfDayInZone,
  msUntilQuietWindowEnd,
  parseTimeToMinutes,
  QuietHoursConfigSchema,
  type QuietHoursConfig,
} from './quiet-hours';

/**
 * Quiet-hours window math (U18 — D92/D93).
 *
 * Timezone + crossing-midnight cases are the mandatory coverage: the
 * window is wall-clock local in an IANA zone, so the same UTC instant
 * can be inside the window in one zone and outside in another.
 */

const window = (overrides: Partial<QuietHoursConfig> = {}): QuietHoursConfig => ({
  enabled: true,
  startLocal: '22:00',
  endLocal: '06:00',
  timezone: 'Asia/Kolkata',
  ...overrides,
});

describe('QuietHoursConfigSchema', () => {
  it('accepts a valid cross-midnight window', () => {
    expect(QuietHoursConfigSchema.safeParse(window()).success).toBe(true);
  });

  it('accepts a same-day window', () => {
    expect(
      QuietHoursConfigSchema.safeParse(window({ startLocal: '09:00', endLocal: '17:00' })).success,
    ).toBe(true);
  });

  it.each([
    ['bad start format', window({ startLocal: '9:00' })],
    ['out-of-range hour', window({ endLocal: '24:00' })],
    ['out-of-range minute', window({ endLocal: '23:60' })],
    ['zero-length window', window({ startLocal: '09:00', endLocal: '09:00' })],
    ['invalid timezone', window({ timezone: 'Mars/Olympus_Mons' })],
    ['empty timezone', window({ timezone: '' })],
    ['unknown key', { ...window(), extra: true } as unknown],
    ['missing enabled', { startLocal: '09:00', endLocal: '17:00', timezone: 'UTC' }],
  ])('rejects %s', (_label, value) => {
    expect(QuietHoursConfigSchema.safeParse(value).success).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/A_Zone')).toBe(false);
  });
});

describe('minutesOfDayInZone', () => {
  it('resolves the wall clock in the configured zone, not UTC', () => {
    // 2026-06-10T18:30:00Z = 2026-06-11T00:00 IST (UTC+5:30).
    const at = new Date('2026-06-10T18:30:00Z');
    expect(minutesOfDayInZone(at, 'Asia/Kolkata')).toBe(0);
    expect(minutesOfDayInZone(at, 'UTC')).toBe(18 * 60 + 30);
  });

  it('throws for an unevaluable timezone', () => {
    expect(() => minutesOfDayInZone(new Date(), 'Not/A_Zone')).toThrow();
  });
});

describe('isWithinQuietWindow — same-day window', () => {
  const cfg = window({ startLocal: '09:00', endLocal: '17:00', timezone: 'UTC' });

  it('is active inside the window', () => {
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T12:00:00Z'))).toBe(true);
  });

  it('is inactive outside the window', () => {
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T08:59:00Z'))).toBe(false);
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T18:00:00Z'))).toBe(false);
  });

  it('start is inclusive, end is exclusive', () => {
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T09:00:00Z'))).toBe(true);
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T17:00:00Z'))).toBe(false);
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T16:59:59Z'))).toBe(true);
  });
});

describe('isWithinQuietWindow — crossing midnight', () => {
  // 22:00 → 06:00 IST. IST = UTC+5:30.
  const cfg = window(); // 22:00–06:00 Asia/Kolkata

  it('is active late evening (before midnight local)', () => {
    // 23:30 IST = 18:00 UTC.
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T18:00:00Z'))).toBe(true);
  });

  it('is active early morning (after midnight local)', () => {
    // 05:30 IST = 00:00 UTC.
    expect(isWithinQuietWindow(cfg, new Date('2026-06-11T00:00:00Z'))).toBe(true);
  });

  it('is inactive during the local day', () => {
    // 12:00 IST = 06:30 UTC.
    expect(isWithinQuietWindow(cfg, new Date('2026-06-10T06:30:00Z'))).toBe(false);
  });

  it('end boundary is exclusive across the midnight wrap', () => {
    // 06:00 IST exactly = 00:30 UTC → window over.
    expect(isWithinQuietWindow(cfg, new Date('2026-06-11T00:30:00Z'))).toBe(false);
    // 05:59 IST = 00:29 UTC → still quiet.
    expect(isWithinQuietWindow(cfg, new Date('2026-06-11T00:29:00Z'))).toBe(true);
  });
});

describe('isWithinQuietWindow — timezone sensitivity', () => {
  it('the same UTC instant is quiet in one zone and not in another', () => {
    // 2026-06-10T20:00:00Z = 01:30 IST Jun 11 (inside 22:00–06:00)
    //                      = 16:00 EDT Jun 10 (outside 22:00–06:00).
    const at = new Date('2026-06-10T20:00:00Z');
    expect(isWithinQuietWindow(window({ timezone: 'Asia/Kolkata' }), at)).toBe(true);
    expect(isWithinQuietWindow(window({ timezone: 'America/New_York' }), at)).toBe(false);
  });
});

describe('isWithinQuietWindow — fail directions', () => {
  it('disabled window is never active', () => {
    expect(isWithinQuietWindow(window({ enabled: false }), new Date('2026-06-10T18:00:00Z'))).toBe(
      false,
    );
  });

  it('enabled window with an unevaluable timezone fails CLOSED (active)', () => {
    const cfg = window({ timezone: 'Not/A_Zone' });
    expect(isWithinQuietWindow(cfg, new Date())).toBe(true);
  });

  it('disabled window with an unevaluable timezone stays inactive', () => {
    const cfg = window({ enabled: false, timezone: 'Not/A_Zone' });
    expect(isWithinQuietWindow(cfg, new Date())).toBe(false);
  });
});

describe('msUntilQuietWindowEnd', () => {
  it('returns null when the window is not active', () => {
    const cfg = window({ startLocal: '09:00', endLocal: '17:00', timezone: 'UTC' });
    expect(msUntilQuietWindowEnd(cfg, new Date('2026-06-10T18:00:00Z'))).toBeNull();
  });

  it('computes the remaining ms in a same-day window', () => {
    const cfg = window({ startLocal: '09:00', endLocal: '17:00', timezone: 'UTC' });
    // 12:00 UTC → 5h left.
    expect(msUntilQuietWindowEnd(cfg, new Date('2026-06-10T12:00:00Z'))).toBe(5 * 60 * 60_000);
  });

  it('computes the remaining ms across the midnight wrap', () => {
    // 23:30 IST (18:00 UTC), window ends 06:00 IST → 6.5h left.
    expect(msUntilQuietWindowEnd(window(), new Date('2026-06-10T18:00:00Z'))).toBe(
      6.5 * 60 * 60_000,
    );
  });

  it('lands AT or AFTER the window end (never inside the window)', () => {
    const cfg = window({ startLocal: '09:00', endLocal: '17:00', timezone: 'UTC' });
    const at = new Date('2026-06-10T16:59:30Z'); // 30s before end
    const ms = msUntilQuietWindowEnd(cfg, at);
    expect(ms).not.toBeNull();
    const resumeAt = new Date(at.getTime() + ms!);
    expect(isWithinQuietWindow(cfg, resumeAt)).toBe(false);
  });

  it('returns null when the timezone is unevaluable (no hint computable)', () => {
    expect(msUntilQuietWindowEnd(window({ timezone: 'Not/A_Zone' }), new Date())).toBeNull();
  });
});

describe('parseTimeToMinutes', () => {
  it('parses HH:MM into minutes-of-day', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });
});
