import { BRIEF_DEFAULT_HOUR } from '@declutrmail/shared/contracts';

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface BriefLocalWindow {
  timeZone: string;
  runDateLocal: string;
  previousDayStart: Date;
  todayStart: Date;
  ready: boolean;
}

/**
 * Resolve one mailbox's D64 generation gate and previous-local-day window.
 *
 * `deliveryHour` is the user's configured local hour (0-23,
 * `preferences.briefPrefs.hour`). Invalid or absent zones deliberately
 * fall back to UTC, and an out-of-range hour falls back to the 8am
 * default, so one bad preference cannot stop the global cron pass —
 * an unclamped 25 would gate `ready` false forever and stall that
 * mailbox's Brief in silence.
 *
 * There is no weekday gate: the Brief generates every local day (D66
 * retired 2026-08-25, founder). A day with no inbound mail still
 * writes the D70 empty brief, which costs no LLM call.
 */
export function resolveBriefLocalWindow(
  now: Date,
  candidateTimeZone: string | null,
  deliveryHour: number,
): BriefLocalWindow {
  const timeZone = validTimeZoneOrUtc(candidateTimeZone);
  const local = partsInTimeZone(now, timeZone);
  const runDateLocal = isoDate(local);
  const previousLocalDate = shiftCalendarDate(local, -1);

  return {
    timeZone,
    runDateLocal,
    previousDayStart: localMidnightToInstant(previousLocalDate, timeZone),
    todayStart: localMidnightToInstant(local, timeZone),
    ready: local.hour >= validDeliveryHourOrDefault(deliveryHour),
  };
}

/** Clamp a stored hour to a usable gate; anything else means 8am. */
function validDeliveryHourOrDefault(candidate: number): number {
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 23) return BRIEF_DEFAULT_HOUR;
  return candidate;
}

export function validTimeZoneOrUtc(candidate: string | null | undefined): string {
  if (!candidate) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return 'UTC';
  }
}

function partsInTimeZone(instant: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: requiredPart(values, 'year'),
    month: requiredPart(values, 'month'),
    day: requiredPart(values, 'day'),
    hour: requiredPart(values, 'hour'),
    minute: requiredPart(values, 'minute'),
    second: requiredPart(values, 'second'),
  };
}

function requiredPart(parts: ReadonlyMap<string, number>, key: string): number {
  const value = parts.get(key);
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`Intl.DateTimeFormat omitted ${key}`);
  }
  return value;
}

function localMidnightToInstant(
  date: Pick<LocalDateParts, 'year' | 'month' | 'day'>,
  timeZone: string,
): Date {
  const targetWallTime = Date.UTC(date.year, date.month - 1, date.day);
  let instant = new Date(targetWallTime);

  // Convert a wall-clock value into an instant by repeatedly correcting the
  // zone offset. Re-evaluating the offset handles DST changes near the target.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsInTimeZone(instant, timeZone);
    const observedWallTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = targetWallTime - observedWallTime;
    if (correction === 0) return instant;
    instant = new Date(instant.getTime() + correction);
  }

  return instant;
}

function shiftCalendarDate(
  date: Pick<LocalDateParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<LocalDateParts, 'year' | 'month' | 'day'> {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isoDate(date: Pick<LocalDateParts, 'year' | 'month' | 'day'>): string {
  return `${date.year.toString().padStart(4, '0')}-${date.month
    .toString()
    .padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`;
}
