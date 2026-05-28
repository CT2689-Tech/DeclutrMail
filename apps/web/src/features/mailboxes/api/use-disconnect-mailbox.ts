/**
 * `useDisconnectMailbox` — calls `DELETE /api/mailboxes/:id`, then
 * resets the mailbox-scoped cache so the dashboard reloads against the
 * now-active mailbox (or the no-active-mailbox gate when the last one
 * is removed). Used by the header account menu.
 *
 * Disconnecting the ACTIVE mailbox is the common case: the BE clears the
 * active-mailbox preference, so a bare `me` invalidation would refresh
 * the account list but leave the previous mailbox's senders/triage data
 * on screen (the stale-screen bug, 2026-05-28). The shared reset is what
 * keeps disconnect in parity with switch.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete } from '@/lib/api/client';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { resetMailboxScopedCache } from './reset-mailbox-cache';

export function useDisconnectMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const env = await apiDelete<MeMailbox>(`/api/mailboxes/${mailboxId}`);
      return env.data;
    },
    onSuccess: () => resetMailboxScopedCache(qc),
  });
}
