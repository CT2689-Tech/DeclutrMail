/**
 * `useSetActiveMailbox` — calls `PATCH /api/mailboxes/:id/active`.
 * Updates `users.preferences.activeMailboxId` server-side so every
 * subsequent request resolves to this mailbox by default. Triggers
 * an invalidate of every feature query so the screen re-renders
 * with data from the newly active mailbox.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch } from '@/lib/api/client';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';

export function useSetActiveMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const env = await apiPatch<{ activeMailboxId: string }>(`/api/mailboxes/${mailboxId}/active`);
      return env.data;
    },
    onSuccess: async () => {
      // Refresh `me` (active mailbox shifted) and any feature data
      // bound to the previous mailbox. The blunt approach — drop the
      // entire query cache — is fine here: switching mailboxes is a
      // rare, deliberate action where stale-screen-flicker is worse
      // than a one-time loading state.
      qc.clear();
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
