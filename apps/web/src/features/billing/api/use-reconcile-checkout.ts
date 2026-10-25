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

import { billingMutationFailure } from './mutation-failure';

export interface ReconcileResult {
  outcome: BillingReconcileOutcome;
  /**
   * `true` only when a `none_found` rests on the provider's own record of
   * the one transaction this checkout created. `undefined` means the API
   * predates the field (a web deploy ahead of its API) — read it as "not
   * exact", and never as "exact".
   */
  exact: BillingReconcileResponse['exact'];
}

export function useReconcileCheckout() {
  return useMutation<ReconcileResult, Error, BillingReconcileRequest>({
    onError: billingMutationFailure('reconcile'),
    mutationFn: async (hint) => {
      // The local pending record rides along as a search hint so a
      // stale lock (server claim already TTL'd + swept) still gets a
      // real provider search instead of `no_pending`.
      const envelope = await apiPost<BillingReconcileResponse>('/api/billing/reconcile', hint);
      return { outcome: envelope.data.outcome, exact: envelope.data.exact };
    },
  });
}
