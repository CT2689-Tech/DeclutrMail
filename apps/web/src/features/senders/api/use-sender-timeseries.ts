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

export function useSenderTimeseries(id: string) {
  return useQuery({
    queryKey: sendersKeys.timeseries(id),
    queryFn: ({ signal }) => fetchSenderTimeseries(id, signal),
    enabled: id.length > 0,
  });
}
