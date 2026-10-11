/**
 * `useBriefToday` — TanStack Query hook for `GET /api/briefs/today`.
 *
 * Returns the frozen 8am snapshot for the current mailbox (D69). No
 * snapshot yet is 404. The fetcher also accepts 204 and a null body,
 * and turns each of those into `{ data: null }`. The screen treats
 * that as "not yet" rather than an error.
 *
 * No polling. D69 is "static for the day" — refetch on focus is
 * sufficient (default behaviour); the worker takes up to an hour to
 * cover every UTC offset's 8am, but a user opening the app twice in
 * five minutes shouldn't poll a feature that does not change.
 *
 * The default `staleTime` (set in `makeQueryClient`) returns the cached
 * payload on tab focus; the user's actions during the day mark rows as
 * "Done" via local state on the screen, never by re-fetching.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchBriefToday } from '@/lib/api/brief';

import { briefTodayQueryOptions } from './query-options';

export function useBriefToday() {
  return useQuery({
    ...briefTodayQueryOptions(fetchBriefToday),
    select: (envelope) => envelope.data,
  });
}
