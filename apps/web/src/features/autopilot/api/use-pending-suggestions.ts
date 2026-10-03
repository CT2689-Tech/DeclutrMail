import { useQuery } from '@tanstack/react-query';
import { fetchPendingSuggestions } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

/** One bounded page; mutations invalidate this and Home through the shared prefix. */
export function usePendingSuggestions(mailboxId: string | null, cursor?: string) {
  return useQuery({
    queryKey: [...autopilotKeys.pendingSuggestions(), 'page', mailboxId, cursor ?? null],
    queryFn: ({ signal }) => fetchPendingSuggestions(signal, cursor),
  });
}
