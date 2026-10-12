import { queryOptions } from '@tanstack/react-query';
import type { BillingInvoiceList, BillingSubscription } from '@declutrmail/shared/contracts';

import { billingKeys } from './query-keys';

type BillingReader<T> = (signal: AbortSignal) => Promise<T>;

export function billingSubscriptionQueryOptions(reader: BillingReader<BillingSubscription>) {
  return queryOptions({
    queryKey: billingKeys.subscription(),
    queryFn: ({ signal }) => reader(signal),
    // A 503 is not retried: the invoice gate observes this same query
    // after the billing screen settles, and retrying that error on mount
    // makes the parent loading again, unmounts the gate, then repeats
    // indefinitely. A dropped fetch is not retried here either — the
    // client already replays a GET, and a second retry loop stacks on it.
    // Explicit refetch still recovers a failed reading.
    retry: false,
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
