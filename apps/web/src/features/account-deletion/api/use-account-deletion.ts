/**
 * Account-deletion hooks (D205, D216, D232) — the FE side of
 * `/api/account/deletion`.
 *
 * USER-scoped (deliberately NOT in the mailbox-scoped cache family —
 * deletion status survives mailbox switches and must render with zero
 * connected mailboxes), so the query key lives outside
 * `resetMailboxScopedCache`'s reset set.
 *
 * Both mutations return the same `AccountDeletionStatus` payload the
 * GET serves, so success handlers write it straight into the cache —
 * the grace banner (mounted in the app layout) flips on/off without a
 * refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountDeletionRequest, AccountDeletionStatus } from '@declutrmail/shared/contracts';
import { apiGet, apiPost } from '@/lib/api/client';

export const ACCOUNT_DELETION_QUERY_KEY = ['account-deletion'] as const;

export function useAccountDeletionStatus() {
  return useQuery({
    queryKey: ACCOUNT_DELETION_QUERY_KEY,
    queryFn: async (): Promise<AccountDeletionStatus> => {
      const env = await apiGet<AccountDeletionStatus>('/api/account/deletion');
      return env.data;
    },
    // The effective date only moves when undo tokens are issued/expire;
    // minute-level staleness is fine for a settings surface.
    staleTime: 60_000,
  });
}

export function useRequestAccountDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AccountDeletionRequest): Promise<AccountDeletionStatus> => {
      const env = await apiPost<AccountDeletionStatus>('/api/account/deletion', body);
      return env.data;
    },
    onSuccess: (status) => qc.setQueryData(ACCOUNT_DELETION_QUERY_KEY, status),
  });
}

export function useCancelAccountDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AccountDeletionStatus> => {
      const env = await apiPost<AccountDeletionStatus>('/api/account/deletion/cancel', {});
      return env.data;
    },
    onSuccess: (status) => qc.setQueryData(ACCOUNT_DELETION_QUERY_KEY, status),
  });
}
