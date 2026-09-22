import type { QueryClient } from '@tanstack/react-query';
import { fetchSenderDetail } from '@/lib/api/senders';
import { senderDetailQueryOptions } from './api/query-options';

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
}
