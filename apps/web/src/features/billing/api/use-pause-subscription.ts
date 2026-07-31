'use client';

/**
 * Pause mutation (D118's pause-30-days offer) — `POST /api/billing/pause`.
 *
 * The response is PRE-PAUSE state, like resume and checkout: a paused
 * subscription grants nothing, and every grant/revoke arrives via the
 * provider webhook (§10). The caller shows the pending-poll state
 * rather than claiming the pause has taken effect.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

import { billingKeys } from './query-keys';

export function usePauseSubscription() {
  const qc = useQueryClient();
  return useMutation<BillingSubscription, Error, void>({
    mutationFn: async () => {
      const envelope = await apiPost<BillingSubscription>('/api/billing/pause', {});
      return envelope.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(billingKeys.subscription(), data);
      // `pause_until` is written in-request but `status` is not — the
      // webhook owns it. Refetch so the paused state appears as soon as
      // it lands rather than on the next natural poll.
      void qc.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}
