import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SnoozedSenderRow } from '@declutrmail/shared/contracts';
import { apiGet } from '@/lib/api/client';

const attentionKeys = (mailboxId: string | null) => ['home-attention', mailboxId] as const;

/** Optional counts are explicitly mailbox-scoped and never join the awaited Undo refresh. */
export function useHomeAttention(mailboxId: string | null, reviewNew: boolean) {
  const client = useQueryClient();
  useEffect(
    () =>
      client.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success')
          void client.invalidateQueries({ queryKey: attentionKeys(mailboxId) });
      }),
    [client, mailboxId],
  );
  const options = {
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  } as const;
  const newSenders = useQuery({
    ...options,
    queryKey: [...attentionKeys(mailboxId), 'new-senders'],
    queryFn: async ({ signal }) =>
      (await apiGet<{ pending: number }>('/api/screener/count', { signal, mailboxId: mailboxId! }))
        .data,
    enabled: mailboxId !== null && reviewNew,
  });
  const later = useQuery({
    ...options,
    queryKey: [...attentionKeys(mailboxId), 'later'],
    queryFn: async ({ signal }) =>
      (await apiGet<SnoozedSenderRow[]>('/api/snoozed', { signal, mailboxId: mailboxId! })).data,
    enabled: mailboxId !== null,
  });
  return { newSenders, later };
}
