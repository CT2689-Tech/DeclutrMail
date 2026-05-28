/**
 * `useDisconnectMailbox` — calls `DELETE /api/mailboxes/:id`, then
 * invalidates the `auth/me` query so the AppShell account list
 * refreshes. Used by the header account menu.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete } from '@/lib/api/client';
import { ME_QUERY_KEY, type MeMailbox } from '@/features/auth/api/use-me';

export function useDisconnectMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const env = await apiDelete<MeMailbox>(`/api/mailboxes/${mailboxId}`);
      return env.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
