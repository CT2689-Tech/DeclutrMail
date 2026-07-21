'use client';

/**
 * Plan-change mutation (D117/D120) — `POST /api/billing/change-plan`.
 *
 * Applies the switch on the EXISTING provider subscription (provider-
 * prorated: upgrades charge the difference now, downgrades credit
 * unused time). THE RESPONSE IS PRE-CHANGE STATE — the tier/cycle flip
 * arrives only via the provider webhook (§10), so the caller enters
 * the pending-poll state instead of writing the cache.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BillingSubscription, PlanChangeRequest } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';
import { billingKeys } from './query-keys';

export function useChangePlan() {
  const queryClient = useQueryClient();
  return useMutation<BillingSubscription, Error, PlanChangeRequest>({
    mutationFn: async (body) => {
      const envelope = await apiPost<BillingSubscription>('/api/billing/change-plan', body);
      return envelope.data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: billingKeys.subscription() }),
  });
}
