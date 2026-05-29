/**
 * `useSecurityEvents` — TanStack `useInfiniteQuery` against the D181
 * operator read API.
 *
 * Infinite (not plain `useQuery`) because the table can grow
 * unboundedly and the operator workflow is "scroll until you see
 * what you're looking for". `getNextPageParam` reads `meta.pagination.
 * nextCursor` — the BE returns `null` on the last page.
 *
 * Filters are part of the query key (via `securityEventsKeys.list(...)`)
 * so toggling severity or event_type swaps the cached page set
 * cleanly rather than mutating the current cursor in place.
 */
import { useInfiniteQuery } from '@tanstack/react-query';

import {
  fetchSecurityEvents,
  type ListSecurityEventsInput,
  type SecurityEventWire,
} from '@/lib/api/security-events';

import { securityEventsKeys } from './query-keys';

export function useSecurityEvents(filters: ListSecurityEventsInput) {
  return useInfiniteQuery({
    queryKey: securityEventsKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      fetchSecurityEvents(
        {
          ...filters,
          ...(typeof pageParam === 'string' && pageParam.length > 0 ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.meta.pagination.nextCursor ?? undefined,
    /**
     * Flattens the per-page row arrays into one list so the screen
     * treats `data.rows` as the visible list and `hasNextPage` as the
     * "Load more" affordance signal.
     */
    select: (response): { rows: SecurityEventWire[]; hasMore: boolean } => ({
      rows: response.pages.flatMap((p) => p.data),
      hasMore: response.pages[response.pages.length - 1]?.meta.pagination.hasMore ?? false,
    }),
  });
}
