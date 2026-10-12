import { queryOptions } from '@tanstack/react-query';

import { backgroundRefetchInterval } from '@/lib/api/background-poll';
import { retryTransientOnly } from '@/lib/api/retry';

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
    refetchInterval: () => backgroundRefetchInterval(SCREENER_COUNT_POLL_MS),
    refetchIntervalInBackground: false,
    // A 4xx is a designed state (guard 409 / tier 402). A dropped fetch
    // is not — retry it, and stop entirely while the tab is hidden or
    // the browser is offline.
    retry: retryTransientOnly,
  });
}
