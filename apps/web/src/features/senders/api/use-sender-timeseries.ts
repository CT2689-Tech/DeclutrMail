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
import { senderTimeseriesQueryOptions } from './query-options';

export function useSenderTimeseries(id: string) {
  return useQuery({
    ...senderTimeseriesQueryOptions(id, (signal) => fetchSenderTimeseries(id, signal)),
    enabled: id.length > 0,
  });
}
