'use client';

import { useBillingSubscription } from './api/use-billing-subscription';
import { InvoiceHistory } from './invoice-history';

/** Mount provider invoice reads only for a workspace with billing history. */
export function BillingInvoiceHistoryGate() {
  const subscription = useBillingSubscription();
  return <InvoiceHistory enabled={subscription.data?.subscription != null} />;
}
