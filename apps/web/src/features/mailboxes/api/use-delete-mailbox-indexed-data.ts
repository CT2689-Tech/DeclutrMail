/**
 * Durable D245 mailbox-index purge command. The server disconnects first,
 * validates the mailbox-specific phrase, and returns the queued lifecycle.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MailboxDataDeletionReceipt } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';
import { resetMailboxScopedCache } from './reset-mailbox-cache';

export interface DeleteMailboxIndexedDataInput {
  mailboxId: string;
  confirmPhrase: string;
}

export function useDeleteMailboxIndexedData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mailboxId, confirmPhrase }: DeleteMailboxIndexedDataInput) => {
      const env = await apiPost<MailboxDataDeletionReceipt>(
        `/api/mailboxes/${mailboxId}/indexed-data-deletion`,
        { confirmPhrase },
      );
      return env.data;
    },
    onSuccess: () => resetMailboxScopedCache(qc),
  });
}
