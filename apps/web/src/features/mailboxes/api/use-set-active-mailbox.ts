/**
 * `useSetActiveMailbox` — calls `PATCH /api/mailboxes/:id/active`.
 * Updates `users.preferences.activeMailboxId` server-side so every
 * subsequent request resolves to this mailbox by default. Triggers
 * an invalidate of every feature query so the screen re-renders
 * with data from the newly active mailbox.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch } from '@/lib/api/client';
import { resetMailboxScopedCache } from './reset-mailbox-cache';

export function useSetActiveMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const env = await apiPatch<{ activeMailboxId: string }>(`/api/mailboxes/${mailboxId}/active`);
      return env.data;
    },
    // Active mailbox shifted — drop the previous mailbox's feature data
    // so the screen reloads against the new one (see resetMailboxScopedCache).
    onSuccess: () => resetMailboxScopedCache(qc),
  });
}
