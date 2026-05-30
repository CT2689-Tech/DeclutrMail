/**
 * `useActivity` — TanStack Query hook for the Activity feed.
 *
 * Plain `useQuery` (not infinite) for the tracer-bullet — the first
 * page is the visible page; "load more" pagination lands with the
 * follow-up PR that adds the scroll affordance. The hook returns the
 * full envelope so the screen can read both `data` (rows) and `meta`
 * (stats + window + source echo) without a second hook.
 *
 * Default `staleTime` (set in `makeQueryClient`) is appropriate —
 * activity rows are append-only at the BE; refetch on focus is fine
 * but more aggressive polling would create flicker without surfacing
 * new data sooner than the writers commit.
 */

import { useQuery } from '@tanstack/react-query';

import {
  fetchActivity,
  type ActivitySourceFilterWire,
  type ActivityWindowWire,
} from '@/lib/api/activity';

import { activityKeys } from './query-keys';

export function useActivity(window: ActivityWindowWire, source: ActivitySourceFilterWire) {
  return useQuery({
    queryKey: activityKeys.list(window, source),
    queryFn: ({ signal }) => fetchActivity({ window, source, signal }),
  });
}
