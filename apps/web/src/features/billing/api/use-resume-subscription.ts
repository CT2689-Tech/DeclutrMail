'use client';

/**
 * Resume mutation (D118 pause exit) — `POST /api/billing/resume`.
 *
 * The response is PRE-RESUME state — entitlement returns only via the
 * provider webhook (§10); the caller enters the pending-poll state.
 */

import { useMutation } from '@tanstack/react-query';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

export function useResumeSubscription() {
  return useMutation<BillingSubscription, Error, void>({
    mutationFn: async () => {
      const envelope = await apiPost<BillingSubscription>('/api/billing/resume', {});
      return envelope.data;
    },
  });
}
