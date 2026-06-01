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
import {
  fetchSenders,
  type GmailCategory,
  type SenderListDirection,
  type SenderListSort,
} from '@/lib/api/senders';
import { sendersKeys } from './query-keys';

export interface UseSendersOptions {
  category?: GmailCategory | undefined;
  /** Page size — clamped by the server to a route-specific max. */
  limit?: number | undefined;
  /**
   * When `true`, request only standing-protected senders (D42/D43).
   * Backs the Settings → Standing Policies surface so it pages server-
   * side instead of fetching the whole mailbox. ADR-0014 + senders list
   * contract.
   */
  isProtected?: boolean | undefined;
  /**
   * Sortable column (ADR-0014). Server-side default = `'total'` when
   * omitted, so omitting takes the contract default — only pass when
   * the caller wants a non-default sort.
   */
  sort?: SenderListSort | undefined;
  /** Sort direction. Server picks a sane default per sort if omitted. */
  direction?: SenderListDirection | undefined;
  /**
   * Gate the query. Pass `false` when there's no active mailbox so the
   * list doesn't fire a `NO_ACTIVE_MAILBOX` 409 (the app shell renders
   * the no-active gate instead). Defaults to enabled.
   */
  enabled?: boolean | undefined;
}

export function useSenders(options: UseSendersOptions = {}) {
  return useInfiniteQuery({
    // Sort + direction are part of the cache key — switching sort/dir
    // resets to page 1 (per the contract: a cursor is bound to its
    // sort context; changing sort discards the cursor).
    queryKey: sendersKeys.list({
      category: options.category,
      limit: options.limit,
      isProtected: options.isProtected,
      sort: options.sort,
      direction: options.direction,
    }),
    queryFn: ({ pageParam, signal }) =>
      fetchSenders(
        {
          category: options.category,
          limit: options.limit,
          isProtected: options.isProtected,
          sort: options.sort,
          direction: options.direction,
          cursor: pageParam ?? undefined,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
  });
}
