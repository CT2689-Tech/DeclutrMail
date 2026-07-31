'use client';

/**
 * Un-cancel mutation (D118) — `POST /api/billing/resume-cancellation`.
 *
 * NOT `useResumeSubscription`: that route un-PAUSES. A cancelling
 * subscription is still `active` with the cancel living in the
 * provider's scheduled-change field, so the two are different states
 * and different calls.
 *
 * The response IS post-revoke truth — unlike resume/checkout, nothing
 * here waits on a webhook: no money moves and no entitlement changes,
 * only the renewal schedule, which the API writes in-request.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

import { billingKeys } from './query-keys';

export function useResumeCancellation() {
  const qc = useQueryClient();
  return useMutation<BillingSubscription, Error, void>({
    mutationFn: async () => {
      const envelope = await apiPost<BillingSubscription>('/api/billing/resume-cancellation', {});
      return envelope.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(billingKeys.subscription(), data);
    },
  });
}
