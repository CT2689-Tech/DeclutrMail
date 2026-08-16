'use client';

/**
 * D119 / ADR-0035 — `GET /api/billing/invoices`.
 *
 * The list is PROXIED from the providers on every read; nothing is
 * stored on our side (ADR-0035 §5). Two consequences shape this hook:
 *
 *   - it is not part of the subscription read, so the payment-processing
 *     and refund-settling polls never drag a provider fan-out along;
 *   - a failed read is a real error state, never an empty list. "You
 *     have no invoices" and "we could not ask" are different sentences,
 *     and only one of them is ever true here.
 */

import { useQuery } from '@tanstack/react-query';
import { BillingInvoiceListSchema, type BillingInvoiceList } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';

import { BillingPayloadError } from '../billing-model';
import { billingKeys } from './query-keys';

export function useInvoices(options?: { enabled?: boolean }) {
  return useQuery<BillingInvoiceList>({
    queryKey: billingKeys.invoices(),
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<unknown>('/api/billing/invoices', { signal });
      const parsed = BillingInvoiceListSchema.safeParse(envelope.data);
      if (!parsed.success) {
        throw new BillingPayloadError();
      }
      return parsed.data;
    },
    // Same rule as the subscription read: billing-dark answers 503 and
    // a read guard's 4xx/5xx is a designed state, never a retry loop
    // (§8 — the 409-storm class).
    retry: false,
    // Longer than the subscription read: invoices change monthly at
    // most, and each refetch costs a provider round-trip per row.
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true,
  });
}
