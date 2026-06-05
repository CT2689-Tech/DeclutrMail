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

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  fetchSenders,
  type ActivityBucket,
  type GmailCategory,
  type SenderListDirection,
  type SenderListSort,
  type TriStateFilter,
} from '@/lib/api/senders';
import { sendersKeys } from './query-keys';

export interface UseSendersOptions {
  category?: GmailCategory | undefined;
  /** Page size — clamped by the server to a route-specific max. */
  limit?: number | undefined;
  /**
   * Tri-state standing-protected filter (D38). `true` = only protected;
   * `false` = exclude protected; omit = no constraint. Backs the
   * Settings → Standing Policies surface + the compose-strip toggle.
   */
  isProtected?: TriStateFilter | undefined;
  /**
   * Sortable column (ADR-0014). Server-side default = `'total'` when
   * omitted, so omitting takes the contract default — only pass when
   * the caller wants a non-default sort.
   */
  sort?: SenderListSort | undefined;
  /** Sort direction. Server picks a sane default per sort if omitted. */
  direction?: SenderListDirection | undefined;
  /**
   * Server-side search (#145). Case-insensitive substring over name /
   * email / domain, mailbox-wide. Pass the (debounced) search term;
   * it's part of the cache key so a new search resets to page 1.
   */
  q?: string | undefined;
  /** D38 compose strip — activity bucket (require). */
  activity?: ActivityBucket | undefined;
  /** D38 compose strip — when true, send the negated form of activity. */
  activityNegate?: boolean | undefined;
  /** D38 compose strip — unsub-readiness tri-state. */
  unsubReady?: TriStateFilter | undefined;
  /** D38 compose strip — "quiet for N days+" filter. */
  windowDays?: number | undefined;
  /** D38 compose strip — domain substring. */
  domain?: string | undefined;
  /**
   * Gate the query. Pass `false` when there's no active mailbox so the
   * list doesn't fire a `NO_ACTIVE_MAILBOX` 409 (the app shell renders
   * the no-active gate instead). Defaults to enabled.
   */
  enabled?: boolean | undefined;
}

export function useSenders(options: UseSendersOptions = {}) {
  return useInfiniteQuery({
    // Sort + direction + every compose axis are part of the cache key.
    // Switching any filter resets to page 1 (per the contract: a cursor
    // is bound to its query context).
    queryKey: sendersKeys.list({
      category: options.category,
      limit: options.limit,
      isProtected: options.isProtected,
      sort: options.sort,
      direction: options.direction,
      q: options.q,
      activity: options.activity,
      activityNegate: options.activityNegate,
      unsubReady: options.unsubReady,
      windowDays: options.windowDays,
      domain: options.domain,
    }),
    queryFn: ({ pageParam, signal }) =>
      fetchSenders(
        {
          category: options.category,
          limit: options.limit,
          isProtected: options.isProtected,
          sort: options.sort,
          direction: options.direction,
          q: options.q,
          activity: options.activity,
          activityNegate: options.activityNegate,
          unsubReady: options.unsubReady,
          windowDays: options.windowDays,
          domain: options.domain,
          cursor: pageParam ?? undefined,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
    // Keep the prior results on screen while a NEW key resolves (e.g. a
    // search term change) so the list doesn't blank to a skeleton on
    // every keystroke — `isLoading` only fires on the first-ever load.
    placeholderData: keepPreviousData,
  });
}
