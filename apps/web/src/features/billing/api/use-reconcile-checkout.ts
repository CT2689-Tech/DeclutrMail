'use client';

/**
 * Provider-truth reconciliation (D249) — `POST /api/billing/reconcile`.
 *
 * Asks the server to ask the PAYMENT PROVIDER what happened to the
 * workspace's pending checkout, instead of asking the customer whether
 * they believe they were charged. The server projects any match through
 * the same webhook path that grants tiers — this mutation never grants
 * anything itself; a `granted` outcome means the next subscription read
 * shows the flip.
 */

import { useMutation } from '@tanstack/react-query';
import type {
  BillingReconcileOutcome,
  BillingReconcileResponse,
} from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

export function useReconcileCheckout() {
  return useMutation<BillingReconcileOutcome, Error, void>({
    mutationFn: async () => {
      const envelope = await apiPost<BillingReconcileResponse>('/api/billing/reconcile', {});
      return envelope.data.outcome;
    },
  });
}
