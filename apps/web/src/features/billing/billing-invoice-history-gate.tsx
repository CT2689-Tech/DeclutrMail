'use client';

import { InvoiceHistory } from './invoice-history';

/** History has its own authenticated, billing-enabled read; current access is independent. */
export function BillingInvoiceHistoryGate() {
  return <InvoiceHistory />;
}
