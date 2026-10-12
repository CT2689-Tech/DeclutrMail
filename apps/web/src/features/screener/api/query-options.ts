import { queryOptions } from '@tanstack/react-query';

import type { ScreenerQueueRow } from '../data';
import { SCREENER_ALL_KEY, SCREENER_QUEUE_KEY } from './query-keys';

export { SCREENER_ALL_KEY, SCREENER_QUEUE_KEY };
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
    // A number, so a hidden or offline tab keeps the timer. TanStack
    // skips the tick while the document is hidden and pauses the fetch
    // while offline; the next tick after the tab returns runs the read.
    // Returning false would clear that timer for good.
    refetchInterval: SCREENER_COUNT_POLL_MS,
    refetchIntervalInBackground: false,
    // A 4xx is a designed state (guard 409 / tier 402). Query retry stays
    // off so it does not stack on the client's own GET retries.
    retry: false,
  });
}
