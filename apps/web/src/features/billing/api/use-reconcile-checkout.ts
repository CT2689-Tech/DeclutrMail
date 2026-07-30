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
  BillingReconcileRequest,
  BillingReconcileResponse,
} from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

export function useReconcileCheckout() {
  return useMutation<BillingReconcileOutcome, Error, BillingReconcileRequest>({
    mutationFn: async (hint) => {
      // The local pending record rides along as a search hint so a
      // stale lock (server claim already TTL'd + swept) still gets a
      // real provider search instead of `no_pending`.
      const envelope = await apiPost<BillingReconcileResponse>('/api/billing/reconcile', hint);
      return envelope.data.outcome;
    },
  });
}
