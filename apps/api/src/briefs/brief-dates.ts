// apps/api/src/briefs/brief-dates.ts — local-date resolution for the
// Brief read surface (D64 "8am in user's local timezone" — read-path
// half; the snapshot worker's generation window stays UTC per its V2
// simplification).
//
// Both snapshot generation and the read surface resolve their day from
// persisted `users.timezone`. Keeping the calendar math here prevents
// callers from drifting at UTC midnight; missing/legacy-invalid stored
// zones use the same UTC fallback as the worker.

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
 * Resolve a local date from an optional IANA timezone:
 *
 *   - absent / empty → UTC date (the original contract; old clients
 *     keep their exact behavior)
 *   - valid IANA name → that zone's calendar date
 *   - invalid → 400 INVALID_TIMEZONE
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

/**
 * Resolve a Brief date from the trusted persisted timezone authority.
 * Unlike a caller-provided zone, legacy-invalid stored values must not
 * break the read path: snapshot generation treats them as UTC too.
 */
export function resolvePersistedBriefTodayLocal(now: Date, timezone: string | null | undefined) {
  const trimmed = timezone?.trim();
  return resolveBriefTodayLocal(now, trimmed && isValidTimeZone(trimmed) ? trimmed : undefined);
}
