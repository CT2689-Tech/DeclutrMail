/**
 * `useSenderMessages` — paginated recent-messages query (D41, D46).
 *
 * `useInfiniteQuery` because D46 caps the inline view at 10 rows but
 * the underlying list can be paged through "View more". The default
 * BE limit is 10 (max 50); we forward the page-size if the caller
 * overrides it.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchSenderMessages } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';
import { retryUnless4xx } from './retry';

export interface UseSenderMessagesOptions {
  /** Page size — default 10 per D46. */
  limit?: number | undefined;
}

export function useSenderMessages(id: string, options: UseSenderMessagesOptions = {}) {
  return useInfiniteQuery({
    queryKey: sendersKeys.messages(id),
    queryFn: ({ pageParam, signal }) =>
      fetchSenderMessages(id, { limit: options.limit, cursor: pageParam ?? undefined }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.pagination.nextCursor ?? undefined,
    // Share the 404-aware retry predicate with `useSenderDetail` so a
    // stale sender id short-circuits all four panes in lockstep
    // (silent-failure-hunter finding on PR #41).
    retry: retryUnless4xx,
    enabled: id.length > 0,
  });
}
