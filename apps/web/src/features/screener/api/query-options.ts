import { queryOptions } from '@tanstack/react-query';

import type { ScreenerQueueRow } from '../data';

/**
 * Shared parent prefix. TanStack matches by prefix, so invalidating this
 * reaches BOTH the queue and the count — which anything that can change
 * membership (a re-score that graduates a sender) must do, or the badge
 * and the list disagree until the count's next poll.
 */
export const SCREENER_ALL_KEY = ['screener'] as const;
export const SCREENER_QUEUE_KEY = ['screener', 'queue'] as const;
export const SCREENER_COUNT_KEY = ['screener', 'count'] as const;
export const SCREENER_COUNT_POLL_MS = 60_000;

type ScreenerReader<T> = (signal: AbortSignal) => Promise<T>;

export function screenerQueueQueryOptions(reader: ScreenerReader<ScreenerQueueRow[]>) {
  return queryOptions({
    queryKey: SCREENER_QUEUE_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}

export function screenerCountQueryOptions(reader: ScreenerReader<{ pending: number }>) {
  return queryOptions({
    queryKey: SCREENER_COUNT_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
    refetchInterval: SCREENER_COUNT_POLL_MS,
    retry: false,
  });
}
