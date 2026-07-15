const BRIEF_LOCAL_HOUR = 8;

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
  weekend: boolean;
}

/**
 * Resolve one mailbox's D64 generation gate and previous-local-day window.
 * Invalid or absent zones deliberately fall back to UTC so one bad preference
 * cannot stop the global cron pass.
 */
export function resolveBriefLocalWindow(
  now: Date,
  candidateTimeZone: string | null,
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
    ready: local.hour >= BRIEF_LOCAL_HOUR,
    weekend: isWeekend(local),
  };
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

function isWeekend(date: Pick<LocalDateParts, 'year' | 'month' | 'day'>): boolean {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day === 0 || day === 6;
}
