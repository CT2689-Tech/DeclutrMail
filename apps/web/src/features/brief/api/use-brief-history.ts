/**
 * `useBriefHistory` — TanStack Query hook for `GET /api/briefs?from=&to=`
 * (D61 Brief history).
 *
 * The endpoint has existed since the Brief shipped and had no consumer:
 * every Brief older than today was written, frozen and then unreachable
 * from the product. This is that consumer.
 *
 * Scope: the range is derived from the day the Brief screen is showing,
 * not from `new Date()` at render time, so a tab left open overnight
 * does not silently start requesting a different window on every
 * re-render and thrash the cache.
 *
 * Failure is deliberately quiet. History is a secondary affordance on a
 * screen whose primary content is today's Brief; if the range read
 * fails, the day switcher simply does not offer other days, and the
 * Brief itself is unaffected. The caller surfaces nothing.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchBriefHistory } from '@/lib/api/brief';

import { briefHistoryQueryOptions } from './query-options';

/** How far back the day switcher looks. */
export const BRIEF_HISTORY_DAYS = 30;

/**
 * Shift a `YYYY-MM-DD` local date string back by `days`.
 *
 * UTC arithmetic on the calendar fields only — the string is already a
 * resolved local date (the BE owns that semantic), so routing it
 * through a real timezone would reintroduce an offset shift.
 */
export function shiftLocalDate(date: string, days: number): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (!Number.isFinite(utc.getTime())) return date;
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * @param anchorRunDate the `runDateLocal` of the Brief currently shown,
 *   or `null` while it is still loading (the query stays disabled).
 */
export function useBriefHistory(anchorRunDate: string | null) {
  const to = anchorRunDate ?? '';
  const from = anchorRunDate ? shiftLocalDate(anchorRunDate, -(BRIEF_HISTORY_DAYS - 1)) : '';

  return useQuery({
    ...briefHistoryQueryOptions(fetchBriefHistory, from, to),
    enabled: anchorRunDate !== null,
    select: (envelope) => envelope.data,
    // A range read that 4xxs is a designed state, not a retry (CLAUDE.md
    // §8): the mailbox guard can 409 here exactly as it does on the
    // today read, and retrying a guard rejection is the 409-storm class.
    retry: false,
  });
}
