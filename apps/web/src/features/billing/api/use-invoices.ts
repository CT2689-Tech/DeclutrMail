'use client';

/**
 * D119 / ADR-0035 — the invoice reads: `GET /api/billing/invoices` and
 * the per-click document mint.
 *
 * The list is PROXIED from the providers on every read; nothing is
 * stored on our side (ADR-0035 §5). Two consequences shape the list
 * hook:
 *
 *   - it is not part of the subscription read, so the payment-processing
 *     and refund-settling polls never drag a provider fan-out along;
 *   - a failed read is a real error state, never an empty list. "You
 *     have no invoices" and "we could not ask" are different sentences,
 *     and only one of them is ever true here.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { BillingInvoiceDocumentSchema } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';

import { BillingPayloadError } from '../billing-model';
import { billingInvoicesQueryOptions } from './query-options';
import { parseBillingInvoices } from './parse-payload';

export function useInvoices(options?: { enabled?: boolean }) {
  return useQuery({
    ...billingInvoicesQueryOptions(async (signal) => {
      const envelope = await apiGet<unknown>('/api/billing/invoices', { signal });
      return parseBillingInvoices(envelope.data);
    }),
    enabled: options?.enabled ?? true,
  });
}

/**
 * Mint a document URL for one invoice and hand it to the browser.
 *
 * A MUTATION in TanStack terms even though the wire verb is GET,
 * because the result may not be cached: the URL is short-lived and
 * authenticates its bearer, so a cache entry would be a stored
 * credential with a stale expiry (ADR-0035 §4). Navigation is
 * `window.location.assign` — the URL only exists after an await, and a
 * popup opened outside the original click gesture is blocked by
 * default; same-tab navigation is never blocked, and Paddle serves the
 * document with a download disposition so the click downloads without
 * leaving the page.
 *
 * Ownership is re-derived server-side from this workspace's own listing
 * — invoices are not persisted, so there is no local row to authorize
 * against and an unchecked id would reach a stranger's invoice. A 404
 * here therefore means "not yours, or no document"; a provider outage
 * comes back as a 502-class error instead, never as "not found".
 */
export function useInvoiceDocument() {
  return useMutation<string, Error, string>({
    mutationFn: async (invoiceId: string) => {
      const envelope = await apiGet<unknown>(
        `/api/billing/invoices/${encodeURIComponent(invoiceId)}/document`,
      );
      const parsed = BillingInvoiceDocumentSchema.safeParse(envelope.data);
      if (!parsed.success) {
        throw new BillingPayloadError('GET /api/billing/invoices/:id/document');
      }
      return parsed.data.url;
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}
