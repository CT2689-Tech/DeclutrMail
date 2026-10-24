import { queryOptions } from '@tanstack/react-query';
import type { BillingInvoiceList, BillingSubscription } from '@declutrmail/shared/contracts';

import { billingKeys } from './query-keys';

type BillingReader<T> = (signal: AbortSignal) => Promise<T>;

export function billingSubscriptionQueryOptions(reader: BillingReader<BillingSubscription>) {
  return queryOptions({
    queryKey: billingKeys.subscription(),
    queryFn: ({ signal }) => reader(signal),
    // Explicit refetch recovers a failed reading. The client already replays
    // a dropped GET, so another retry loop would stack on it. Do not retry
    // errors on remount either: plan rendering must settle to its error or
    // billing-disabled state while history reads independently.
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
