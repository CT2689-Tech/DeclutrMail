import 'server-only';

import type { BillingInvoiceList } from '@declutrmail/shared/contracts';

import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { billingInvoicesQueryOptions } from './api/query-options';
import { parseBillingInvoices } from './api/parse-payload';
import { getServerBillingSubscription } from './api/server-billing';
import { BillingInvoiceHistoryGate } from './billing-invoice-history-gate';

/** Stream the provider-backed invoice fan-out independently from the plan card. */
export async function ServerBillingInvoices({ cookieHeader }: { cookieHeader: string }) {
  let enabled = false;
  try {
    enabled = (await getServerBillingSubscription(cookieHeader)).subscription !== null;
  } catch {
    // The subscription boundary owns reporting and browser fallback. The
    // client gate below will mount invoices if that fallback later succeeds.
  }

  return ServerQueryHydration({
    surface: 'billing-invoices',
    prefetch: (queryClient) =>
      enabled
        ? [
            queryClient.fetchQuery(
              billingInvoicesQueryOptions(async (signal): Promise<BillingInvoiceList> =>
                parseBillingInvoices(
                  await serverGet<unknown>('/api/billing/invoices', cookieHeader, signal),
                ),
              ),
            ),
          ]
        : [],
    children: <BillingInvoiceHistoryGate />,
  });
}
