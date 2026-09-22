/**
 * `useSenderTimeseries` — fixed 12-month window, no pagination (D45).
 *
 * The window is server-side fixed (no cursor) so a plain `useQuery`
 * is sufficient. The shared query options retain it for five minutes on revisits;
 * explicit mutation and mailbox invalidation still reconciles server truth.
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
