// apps/api/src/briefs/brief-dates.ts — local-date resolution for the
// Brief read surface (D64 "8am in user's local timezone" — read-path
// half; the snapshot worker's generation window stays UTC per its V2
// simplification).
//
// The FE sends its IANA timezone on `GET /api/briefs/today?tz=…` and
// the server resolves "today" in THAT zone, so a user in
// Pacific/Auckland at 9am local no longer gets yesterday's Brief just
// because UTC hasn't rolled over (and an America/Los_Angeles evening
// no longer shows tomorrow's 404). No `tz` param → UTC date, exactly
// the pre-existing behavior (backward compatible).

import { BadRequestException } from '@nestjs/common';

/**
 * True when `tz` names a timezone the runtime's ICU data can resolve.
 * `Intl.DateTimeFormat` throws a RangeError on unknown zone names —
 * that throw IS the validation.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the calendar date (`YYYY-MM-DD`) of `now` in the given IANA
 * timezone. `en-CA` formats as ISO `YYYY-MM-DD` directly, so no
 * part-reassembly is needed.
 */
export function localDateInTimeZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Resolve the "today" the Brief lookup should use from the optional
 * `?tz=` query param:
 *
 *   - absent / empty → UTC date (the original contract; old clients
 *     keep their exact behavior)
 *   - valid IANA name → that zone's calendar date
 *   - invalid → 400 INVALID_TIMEZONE (a NEW param has no legacy
 *     callers to stay lenient for — failing loudly beats silently
 *     serving the wrong day)
 */
export function resolveBriefTodayLocal(now: Date, tz: string | undefined): string {
  const trimmed = tz?.trim();
  if (!trimmed) {
    return now.toISOString().slice(0, 10);
  }
  if (!isValidTimeZone(trimmed)) {
    throw new BadRequestException({
      code: 'INVALID_TIMEZONE',
      message: `Unknown IANA timezone: ${trimmed}`,
    });
  }
  return localDateInTimeZone(now, trimmed);
}
