/**
 * `useSenderHistory` — paginated decision history (D46).
 *
 * The detail page surfaces the 10 most recent rows inline; "View full
 * history →" navigates to the activity log. Cursor pagination keeps
 * the inline list honest against concurrent inserts (e.g. an Autopilot
 * worker writing a new row while the user is reading the page).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchSenderHistory } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';
import { retryUnless404 } from './retry';

export interface UseSenderHistoryOptions {
  /** Page size — default 10 per D46. */
  limit?: number | undefined;
}

export function useSenderHistory(id: string, options: UseSenderHistoryOptions = {}) {
  return useInfiniteQuery({
    queryKey: sendersKeys.history(id),
    queryFn: ({ pageParam, signal }) =>
      fetchSenderHistory(id, { limit: options.limit, cursor: pageParam ?? undefined }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    // Share the 404-aware retry predicate with `useSenderDetail` so a
    // stale sender id short-circuits all four panes in lockstep
    // (silent-failure-hunter finding on PR #41).
    retry: retryUnless404,
    enabled: id.length > 0,
  });
}
