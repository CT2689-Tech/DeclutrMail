// Tests for `resolveBriefTodayLocal` — the D64 read-path local-date
// resolution. Covers both midnight-edge directions (zone ahead of UTC,
// zone behind UTC), the UTC fallback contract, and invalid-tz rejection.

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  isValidTimeZone,
  localDateInTimeZone,
  resolveBriefTodayLocal,
  resolvePersistedBriefTodayLocal,
} from './brief-dates.js';

describe('resolveBriefTodayLocal (D64 read-path)', () => {
  // 2026-07-07T20:00Z — evening UTC. Auckland (UTC+12) is already
  // 2026-07-08; Los Angeles (UTC-7 in July) is still 2026-07-07.
  const EVENING_UTC = new Date('2026-07-07T20:00:00Z');
  // 2026-07-08T02:00Z — small hours UTC. Auckland agrees it is the
  // 8th; Los Angeles is still on the 7th (previous local day).
  const SMALL_HOURS_UTC = new Date('2026-07-08T02:00:00Z');

  it('zone AHEAD of UTC — local date is already tomorrow at UTC evening', () => {
    expect(resolveBriefTodayLocal(EVENING_UTC, 'Pacific/Auckland')).toBe('2026-07-08');
  });

  it('zone BEHIND UTC — local date is still yesterday in UTC small hours', () => {
    expect(resolveBriefTodayLocal(SMALL_HOURS_UTC, 'America/Los_Angeles')).toBe('2026-07-07');
  });

  it('agrees with UTC when the zones share a calendar date', () => {
    expect(resolveBriefTodayLocal(EVENING_UTC, 'America/Los_Angeles')).toBe('2026-07-07');
    expect(resolveBriefTodayLocal(SMALL_HOURS_UTC, 'Pacific/Auckland')).toBe('2026-07-08');
  });

  it('half-hour offset zones resolve correctly (Asia/Kolkata, UTC+5:30)', () => {
    // 2026-07-07T18:31Z → 2026-07-08 00:01 IST (just past local midnight).
    expect(resolveBriefTodayLocal(new Date('2026-07-07T18:31:00Z'), 'Asia/Kolkata')).toBe(
      '2026-07-08',
    );
    // 2026-07-07T18:29Z → 2026-07-07 23:59 IST (just before local midnight).
    expect(resolveBriefTodayLocal(new Date('2026-07-07T18:29:00Z'), 'Asia/Kolkata')).toBe(
      '2026-07-07',
    );
  });

  it('falls back to the UTC date when tz is absent or blank (backward compatible)', () => {
    expect(resolveBriefTodayLocal(EVENING_UTC, undefined)).toBe('2026-07-07');
    expect(resolveBriefTodayLocal(EVENING_UTC, '')).toBe('2026-07-07');
    expect(resolveBriefTodayLocal(EVENING_UTC, '   ')).toBe('2026-07-07');
  });

  it('rejects an unknown timezone with 400 INVALID_TIMEZONE', () => {
    expect(() => resolveBriefTodayLocal(EVENING_UTC, 'Mars/Olympus_Mons')).toThrow(
      BadRequestException,
    );
  });
});

describe('isValidTimeZone', () => {
  it('accepts real IANA names and rejects junk', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Not/A_Zone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('resolvePersistedBriefTodayLocal', () => {
  const EVENING_UTC = new Date('2026-07-07T20:00:00Z');

  it('uses a valid persisted zone', () => {
    expect(resolvePersistedBriefTodayLocal(EVENING_UTC, 'Pacific/Auckland')).toBe('2026-07-08');
  });

  it('uses UTC for missing and legacy-invalid persisted zones', () => {
    expect(resolvePersistedBriefTodayLocal(EVENING_UTC, null)).toBe('2026-07-07');
    expect(resolvePersistedBriefTodayLocal(EVENING_UTC, 'Mars/Olympus_Mons')).toBe('2026-07-07');
  });
});

describe('localDateInTimeZone', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(localDateInTimeZone(new Date('2026-01-01T00:30:00Z'), 'UTC')).toBe('2026-01-01');
  });
});
