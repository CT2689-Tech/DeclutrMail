/**
 * Quiet-hours contract + window math (U18 — D92, D93, D95).
 *
 * One recurring daily quiet window per mailbox: local wall-clock start +
 * end ("HH:MM", 24h) interpreted in an IANA timezone, plus an enabled
 * flag. While the window covers "now", Autopilot mutations DEFER —
 * matches stay durable (`rule_match_log.intent_applied=false`) and the
 * next sweep executes them after the window ends. Manual user actions
 * are never deferred (user intent wins; quiet gates automation only).
 *
 * Windows may CROSS MIDNIGHT: `startLocal > endLocal` (e.g. 18:00 →
 * 09:00) means the window spans the day boundary. `startLocal ===
 * endLocal` is rejected — a zero-length window is ambiguous with a
 * 24-hour one, and "always quiet" is what `enabled` + a manual quiet
 * toggle are for.
 *
 * Boundary semantics: start INCLUSIVE, end EXCLUSIVE — at exactly
 * `endLocal` the window is over.
 *
 * Fail-closed rule: when the configured timezone cannot be evaluated at
 * runtime (ICU data drift — the PUT path validates it at write time),
 * an ENABLED window counts as active. Ambiguity defers mutations rather
 * than firing them; the deferral is observable (`deferredQuiet` metric)
 * and never drops actions.
 *
 * Privacy (D7, D228): times + a timezone string only — no message data.
 */

import { z } from 'zod';

/** "HH:MM" — 24h local wall-clock time. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when `Intl` can evaluate the IANA timezone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The PUT body / stored-config wire shape. `.strict()` so unknown keys
 * are rejected — the storage column is co-tenanted jsonb and must never
 * accumulate junk keys.
 */
export const QuietHoursConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Window start, local wall-clock "HH:MM" (inclusive). */
    startLocal: z.string().regex(TIME_RE, 'startLocal must be "HH:MM" (24h)'),
    /** Window end, local wall-clock "HH:MM" (exclusive). */
    endLocal: z.string().regex(TIME_RE, 'endLocal must be "HH:MM" (24h)'),
    /** IANA timezone name, e.g. "Asia/Kolkata". */
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimeZone, 'timezone must be a valid IANA timezone name'),
  })
  .strict()
  .refine((c) => c.startLocal !== c.endLocal, {
    message: 'startLocal and endLocal must differ (zero-length window)',
    path: ['endLocal'],
  });
export type QuietHoursConfig = z.infer<typeof QuietHoursConfigSchema>;

/** GET/PUT response data: the stored config (null = never configured) + the live predicate. */
export interface QuietHoursState {
  config: QuietHoursConfig | null;
  /** True when quiet is active RIGHT NOW (recurring window or manual quiet state). */
  activeNow: boolean;
}

/** Parse "HH:MM" → minutes-of-day. Assumes the schema regex already matched. */
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Minutes-of-day of `at` in `timeZone` (0–1439). Throws when the
 * timezone cannot be evaluated — callers decide the fail direction.
 */
export function minutesOfDayInZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`Could not resolve wall-clock time in timezone "${timeZone}"`);
  }
  return hour * 60 + minute;
}

/**
 * True when `at` falls inside the configured quiet window.
 *
 *   - `enabled: false` → never active.
 *   - `start < end`    → same-day window: `start <= now < end`.
 *   - `start > end`    → crosses midnight: `now >= start OR now < end`.
 *   - Unevaluable timezone → ACTIVE (fail closed; see module header).
 */
export function isWithinQuietWindow(config: QuietHoursConfig, at: Date): boolean {
  if (!config.enabled) return false;
  let nowMin: number;
  try {
    nowMin = minutesOfDayInZone(at, config.timezone);
  } catch {
    return true; // Fail closed — defer mutations when the zone is unevaluable.
  }
  const start = parseTimeToMinutes(config.startLocal);
  const end = parseTimeToMinutes(config.endLocal);
  if (start < end) {
    return nowMin >= start && nowMin < end;
  }
  return nowMin >= start || nowMin < end;
}

/**
 * Milliseconds until the active window ends — a RE-SCHEDULE HINT for
 * deferred sweeps, not a source of truth (the quiet guard re-checks at
 * execution time, so a DST-shifted early wake simply re-defers).
 *
 * Returns `null` when the window is not active at `at`, or when the
 * timezone cannot be evaluated (no hint is computable). The value is
 * minute-granular and always lands AT or AFTER the window end.
 */
export function msUntilQuietWindowEnd(config: QuietHoursConfig, at: Date): number | null {
  if (!isWithinQuietWindow(config, at)) return null;
  let nowMin: number;
  try {
    nowMin = minutesOfDayInZone(at, config.timezone);
  } catch {
    return null;
  }
  const end = parseTimeToMinutes(config.endLocal);
  const minutesLeft = (end - nowMin + 1440) % 1440;
  // minutesLeft is in [1, 1439]: end===nowMin is impossible while the
  // window is active (end is exclusive).
  return minutesLeft * 60_000;
}
