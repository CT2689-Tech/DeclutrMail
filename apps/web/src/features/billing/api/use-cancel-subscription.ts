'use client';

/**
 * Cancel mutation (D118/D120) — `POST /api/billing/cancel`.
 *
 * Cancellation takes effect at period end (no proration); the BE calls
 * the provider FIRST and only then records `cancel_at_period_end`. The
 * response is the refreshed `BillingSubscription`, written back into
 * the subscription query so the plan card shows the scheduled cancel
 * without a refetch.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BillingSubscription, CancelRequest } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

import { billingKeys } from './query-keys';

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation<BillingSubscription, Error, CancelRequest>({
    mutationFn: async (body) => {
      const envelope = await apiPost<BillingSubscription>('/api/billing/cancel', body);
      return envelope.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.subscription(), data);
    },
  });
}
