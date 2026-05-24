/**
 * `useSenderTimeseries` — fixed 12-month window, no pagination (D45).
 *
 * The window is server-side fixed (no cursor) so a plain `useQuery`
 * is sufficient. A longer `staleTime` would be reasonable here (volume
 * changes daily at most) but we keep the QueryClient default for
 * predictability — the chart re-renders cheaply.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchSenderTimeseries } from '@/lib/api/senders';
import { sendersKeys } from './query-keys';
import { retryUnless404 } from './retry';

export function useSenderTimeseries(id: string) {
  return useQuery({
    queryKey: sendersKeys.timeseries(id),
    queryFn: ({ signal }) => fetchSenderTimeseries(id, signal),
    // Share the 404-aware retry predicate with `useSenderDetail` so a
    // stale sender id short-circuits all four panes in lockstep
    // (silent-failure-hunter finding on PR #41).
    retry: retryUnless404,
    enabled: id.length > 0,
  });
}
