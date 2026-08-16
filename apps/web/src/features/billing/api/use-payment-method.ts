'use client';

/**
 * D119 / ADR-0035 — the two per-click mints: a payment-method session
 * and an invoice document.
 *
 * Both are MUTATIONS in TanStack terms even though one is a GET,
 * because neither result may be cached. The URLs they return are
 * short-lived and authenticate their bearer, so a cache entry would be
 * a stored credential with a stale expiry (ADR-0035 §4).
 *
 * Both navigate with `window.location.assign` rather than
 * `window.open`. The URL only exists after an await, and a popup opened
 * outside the original click gesture is blocked by default — the user
 * would press the button and watch nothing happen. Same-tab navigation
 * is never blocked; Paddle serves its invoice with a download
 * disposition, so that click downloads without leaving the page, while
 * the portal click intentionally does leave and returns after.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BillingInvoiceDocumentSchema,
  PaymentMethodSessionSchema,
  type PaymentMethodSession,
} from '@declutrmail/shared/contracts';

import { apiGet, apiPost } from '@/lib/api/client';

import { BillingPayloadError } from '../billing-model';
import { billingKeys } from './query-keys';

/**
 * Mint a payment-method session and go there.
 *
 * The `unsupported` arm resolves normally — it is a 200 and an answer
 * (Razorpay has no self-serve path), so it must not land in `error`
 * where the UI would offer a retry that can never succeed. The caller
 * reads the resolved value and renders the support-assisted state.
 */
export function usePaymentMethodSession() {
  const queryClient = useQueryClient();
  return useMutation<PaymentMethodSession>({
    mutationFn: async () => {
      const envelope = await apiPost<unknown>('/api/billing/payment-method/session', {});
      const parsed = PaymentMethodSessionSchema.safeParse(envelope.data);
      if (!parsed.success) {
        throw new BillingPayloadError();
      }
      return parsed.data;
    },
    onSuccess: (session) => {
      if (session.kind !== 'url') return;
      // The instrument may change while the customer is away, and the
      // dunning status with it. Mark the read stale BEFORE leaving so
      // the return lands on a refetch rather than the old past_due card.
      void queryClient.invalidateQueries({ queryKey: billingKeys.subscription() });
      window.location.assign(session.url);
    },
  });
}

/**
 * Mint a document URL for one invoice and hand it to the browser.
 *
 * Ownership is re-derived server-side from this workspace's own listing
 * — invoices are not persisted, so there is no local row to authorize
 * against and an unchecked id would reach a stranger's invoice. A 404
 * here therefore means "not yours, or no document", and the UI says the
 * honest version of that rather than retrying.
 */
export function useInvoiceDocument() {
  return useMutation<string, unknown, string>({
    mutationFn: async (invoiceId: string) => {
      const envelope = await apiGet<unknown>(
        `/api/billing/invoices/${encodeURIComponent(invoiceId)}/document`,
      );
      const parsed = BillingInvoiceDocumentSchema.safeParse(envelope.data);
      if (!parsed.success) {
        throw new BillingPayloadError();
      }
      return parsed.data.url;
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}
