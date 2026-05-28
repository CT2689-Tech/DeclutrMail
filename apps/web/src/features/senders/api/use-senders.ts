/**
 * `useSenders` — TanStack Query hook for the paginated sender list.
 *
 * Wraps `fetchSenders` in `useInfiniteQuery` so the screen can pull
 * additional pages with `fetchNextPage`. Cursor pagination per D202 —
 * the FE never builds a cursor, just forwards the opaque `nextCursor`
 * the BE sent on the prior page.
 *
 * Why `useInfiniteQuery` instead of plain `useQuery`? The list page
 * needs to grow as the user scrolls — and the BE clamps page size
 * (default 50 per D202 norms), so a single fetch can't return the
 * whole mailbox. Infinite query gives us page-by-page accumulation
 * with built-in `hasNextPage` derived from `meta.pagination.hasMore`.
 *
 * The default `staleTime` (30s, set in `makeQueryClient`) is intentional
 * for this list — sender cadence changes slowly compared to UI think
 * time, and refetching on every action would create flicker.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchSenders, type GmailCategory } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';

export interface UseSendersOptions {
  category?: GmailCategory | undefined;
  /** Page size — clamped by the server to a route-specific max. */
  limit?: number | undefined;
  /**
   * Gate the query. Pass `false` when there's no active mailbox so the
   * list doesn't fire a `NO_ACTIVE_MAILBOX` 409 (the app shell renders
   * the no-active gate instead). Defaults to enabled.
   */
  enabled?: boolean | undefined;
}

export function useSenders(options: UseSendersOptions = {}) {
  return useInfiniteQuery({
    queryKey: sendersKeys.list({ category: options.category }),
    queryFn: ({ pageParam, signal }) =>
      fetchSenders(
        {
          category: options.category,
          limit: options.limit,
          cursor: pageParam ?? undefined,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
  });
}
