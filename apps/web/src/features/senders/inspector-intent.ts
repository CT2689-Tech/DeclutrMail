import type { QueryClient } from '@tanstack/react-query';
import {
  fetchSenderDetail,
  fetchSenderMessages,
  fetchSenderTimeseries,
  fetchSenderHistory,
} from '@/lib/api/senders';
import {
  senderDetailQueryOptions,
  senderMessagesQueryOptions,
  senderTimeseriesQueryOptions,
  senderHistoryQueryOptions,
} from './api/query-options';

export const loadSenderInspector = () => import('./detail/sender-detail-pane');

/** Speculation only: never bypass mailbox cancellation or prefetch a whole list. */
export function prefetchSenderInspector(client: QueryClient, id: string, speculative = true): void {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (speculative && (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')))
    return;
  void loadSenderInspector().catch(() => undefined);
  void client.prefetchQuery({
    ...senderDetailQueryOptions(id, (signal) => fetchSenderDetail(id, signal)),
    retry: false,
  });
  // A click commits to opening the pane. Start its remaining reads while
  // the lazy chunk loads, not after React mounts it. Hover remains cheap.
  if (!speculative) {
    void client.prefetchInfiniteQuery({
      ...senderMessagesQueryOptions(id, (cursor, signal) =>
        fetchSenderMessages(id, { cursor }, signal),
      ),
      retry: false,
    });
    void client.prefetchQuery({
      ...senderTimeseriesQueryOptions(id, (signal) => fetchSenderTimeseries(id, signal)),
      retry: false,
    });
    void client.prefetchInfiniteQuery({
      ...senderHistoryQueryOptions(id, (cursor, signal) =>
        fetchSenderHistory(id, { cursor }, signal),
      ),
      retry: false,
    });
  }
}
