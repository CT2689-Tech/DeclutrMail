/**
 * `useQuietHours` — TanStack Query hook for one mailbox's quiet-hours
 * config (U18 — D92/D95). The Quiet screen mounts one instance per
 * connected mailbox.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchQuietHours } from '@/lib/api/quiet-hours';
import { quietKeys } from './query-keys';

export function useQuietHours(mailboxId: string) {
  return useQuery({
    queryKey: quietKeys.hours(mailboxId),
    queryFn: async ({ signal }) => {
      const env = await fetchQuietHours(mailboxId, signal);
      return env.data;
    },
  });
}
