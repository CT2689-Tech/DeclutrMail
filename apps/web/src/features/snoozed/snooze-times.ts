/**
 * Pure date helpers for the Snoozed surface (D80 grouping + D82
 * presets). All functions take an explicit `now` so tests are
 * deterministic; callers pass `new Date()`.
 *
 * Times are computed in the user's LOCAL timezone (D82 — "5:00 PM
 * local", "9:00 AM local") and serialized to ISO on the wire.
 */

import type { SnoozedSenderRow } from '@/lib/api/snoozed';

// ── D80 wake-time buckets ─────────────────────────────────────────────

export const WAKE_BUCKETS = ['today', 'tomorrow', 'week', 'eventually', 'none'] as const;
export type WakeBucket = (typeof WAKE_BUCKETS)[number];

export const WAKE_BUCKET_LABELS: Record<WakeBucket, string> = {
  today: 'Later today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  eventually: 'Eventually',
  // Legacy mirror-only rows created before Later required a wake time.
  none: 'Needs scheduling',
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** D80 — bucket a wake time relative to `now` (local calendar days). */
export function wakeBucket(snoozedUntil: string | null, now: Date): WakeBucket {
  if (snoozedUntil === null) return 'none';
  const wake = new Date(snoozedUntil);
  if (Number.isNaN(wake.getTime())) return 'none';
  const tomorrowStart = startOfDay(addDays(now, 1));
  if (wake < tomorrowStart) return 'today';
  if (wake < startOfDay(addDays(now, 2))) return 'tomorrow';
  if (wake < startOfDay(addDays(now, 7))) return 'week';
  return 'eventually';
}

export type GroupedSnoozed = Record<WakeBucket, SnoozedSenderRow[]>;

export function groupByWakeTime(rows: readonly SnoozedSenderRow[], now: Date): GroupedSnoozed {
  const grouped: GroupedSnoozed = { today: [], tomorrow: [], week: [], eventually: [], none: [] };
  for (const row of rows) {
    grouped[wakeBucket(row.snoozedUntil, now)].push(row);
  }
  return grouped;
}

/** "Tomorrow 9:00 AM" / "Fri 7:00 AM" / "May 23" — D80 row format. */
export function formatWakeTime(iso: string, now: Date): string {
  const wake = new Date(iso);
  if (Number.isNaN(wake.getTime())) return '';
  const time = wake.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const bucket = wakeBucket(iso, now);
  if (bucket === 'today') return `Today ${time}`;
  if (bucket === 'tomorrow') return `Tomorrow ${time}`;
  if (bucket === 'week') {
    return `${wake.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  }
  return wake.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
