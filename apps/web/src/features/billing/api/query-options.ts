import { queryOptions } from '@tanstack/react-query';
import type { BillingInvoiceList, BillingSubscription } from '@declutrmail/shared/contracts';

import { billingKeys } from './query-keys';

type BillingReader<T> = (signal: AbortSignal) => Promise<T>;

export function billingSubscriptionQueryOptions(reader: BillingReader<BillingSubscription>) {
  return queryOptions({
    queryKey: billingKeys.subscription(),
    queryFn: ({ signal }) => reader(signal),
    retry: false,
    // The invoice gate observes this same query after the billing screen
    // settles. Retrying its error on that mount makes the parent loading
    // again, unmounts the gate, then repeats indefinitely on the next 503.
    // Explicit refetch/invalidation still recovers a failed reading.
    retryOnMount: false,
    staleTime: 60_000,
  });
}

export function billingInvoicesQueryOptions(reader: BillingReader<BillingInvoiceList>) {
  return queryOptions({
    queryKey: billingKeys.invoices(),
    queryFn: ({ signal }) => reader(signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}
