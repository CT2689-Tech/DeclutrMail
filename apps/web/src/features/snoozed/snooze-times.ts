/**
 * Pure date helpers for the Snoozed surface (D80 grouping + D82
 * presets). All functions take an explicit `now` — and, for the
 * bucket/label helpers, an explicit IANA `timeZone` — so tests are
 * deterministic; callers pass `new Date()` and `useUserTimeZone()`.
 *
 * Times are computed in the user's timezone (D82 — "5:00 PM local",
 * "9:00 AM local") and serialized to ISO on the wire. The zone must be
 * an explicit argument because these labels are server-rendered into
 * hydrated HTML (/later): the server's process zone is not the user's,
 * and locale/zone drift between the server string and the first client
 * render makes React discard the server tree (error #418; e2e
 * hydration-smoke). The `now` clock itself still differs by the
 * hydration delay — a midnight crossing inside that window can flip a
 * bucket (rare, accepted; React falls back to a client render).
 */

import type { SnoozedSenderRow } from '@/lib/api/snoozed';

// ── D80 wake-time buckets ─────────────────────────────────────────────

export const WAKE_BUCKETS = ['today', 'tomorrow', 'week', 'eventually'] as const;
export type WakeBucket = (typeof WAKE_BUCKETS)[number];

export const WAKE_BUCKET_LABELS: Record<WakeBucket, string> = {
  today: 'Later today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  eventually: 'Eventually',
};

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Calendar-day ordinal of an instant in an IANA zone. en-CA renders
 * YYYY-MM-DD; converting those fields to a UTC day count makes integer
 * differences calendar-day differences in that zone.
 */
function calendarDayOrdinal(d: Date, timeZone: string): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return Date.UTC(y, m - 1, day) / 86_400_000;
}

/** D80 — bucket a wake time relative to `now` (calendar days in `timeZone`). */
export function wakeBucket(snoozedUntil: string, now: Date, timeZone: string): WakeBucket {
  const wake = new Date(snoozedUntil);
  if (Number.isNaN(wake.getTime())) {
    throw new RangeError('Invalid Later wake time.');
  }
  const dayDiff = calendarDayOrdinal(wake, timeZone) - calendarDayOrdinal(now, timeZone);
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'tomorrow';
  if (dayDiff < 7) return 'week';
  return 'eventually';
}

export type GroupedSnoozed = Record<WakeBucket, SnoozedSenderRow[]>;

export function groupByWakeTime(
  rows: readonly SnoozedSenderRow[],
  now: Date,
  timeZone: string,
): GroupedSnoozed {
  const grouped: GroupedSnoozed = { today: [], tomorrow: [], week: [], eventually: [] };
  for (const row of rows) {
    grouped[wakeBucket(row.snoozedUntil, now, timeZone)].push(row);
  }
  return grouped;
}

/** "Tomorrow 9:00 AM" / "Fri 7:00 AM" / "May 23" — D80 row format. */
export function formatWakeTime(iso: string, now: Date, timeZone: string): string {
  const wake = new Date(iso);
  if (Number.isNaN(wake.getTime())) {
    throw new RangeError('Invalid Later wake time.');
  }
  const time = wake.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const bucket = wakeBucket(iso, now, timeZone);
  if (bucket === 'today') return `Today ${time}`;
  if (bucket === 'tomorrow') return `Tomorrow ${time}`;
  if (bucket === 'week') {
    return `${wake.toLocaleDateString('en-US', { weekday: 'short', timeZone })} ${time}`;
  }
  return wake.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
}

// ── D82 presets ───────────────────────────────────────────────────────

export interface SnoozePreset {
  id: 'later_today' | 'tomorrow' | 'weekend' | 'next_week' | 'next_month';
  label: string;
  /** The wake Date this preset resolves to, given `now`. */
  at: Date;
}

function at(d: Date, hours: number): Date {
  const out = new Date(d);
  out.setHours(hours, 0, 0, 0);
  return out;
}

/**
 * The D82 preset list, resolved against `now`. "Later today" (5 PM) is
 * omitted once it would be in the past — a preset must always yield a
 * future wake time (the contract rejects past values).
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [];

  const laterToday = at(now, 17);
  if (laterToday > now) {
    presets.push({ id: 'later_today', label: 'Later today (5:00 PM)', at: laterToday });
  }

  presets.push({ id: 'tomorrow', label: 'Tomorrow (9:00 AM)', at: at(addDays(now, 1), 9) });

  // Next Saturday — when today IS Saturday (or Sunday), the coming one.
  const day = now.getDay(); // 0 = Sunday … 6 = Saturday
  const daysToSaturday = (6 - day + 7) % 7 || 7;
  presets.push({
    id: 'weekend',
    label: 'This weekend (Sat 9:00 AM)',
    at: at(addDays(now, daysToSaturday), 9),
  });

  const daysToMonday = (1 - day + 7) % 7 || 7;
  presets.push({
    id: 'next_week',
    label: 'Next week (Mon 9:00 AM)',
    at: at(addDays(now, daysToMonday), 9),
  });

  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0, 0);
  presets.push({ id: 'next_month', label: 'Next month (1st, 9:00 AM)', at: firstOfNextMonth });

  return presets;
}
