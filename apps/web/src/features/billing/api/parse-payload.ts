import {
  BillingInvoiceListSchema,
  BillingSubscriptionSchema,
  type BillingInvoiceList,
  type BillingSubscription,
} from '@declutrmail/shared/contracts';

import { BillingPayloadError } from '../billing-model';

export function parseBillingSubscription(payload: unknown): BillingSubscription {
  const parsed = BillingSubscriptionSchema.safeParse(payload);
  if (!parsed.success) throw new BillingPayloadError();
  return parsed.data;
}

export function parseBillingInvoices(payload: unknown): BillingInvoiceList {
  const parsed = BillingInvoiceListSchema.safeParse(payload);
  if (!parsed.success) throw new BillingPayloadError('GET /api/billing/invoices');
  return parsed.data;
}
