import { parseUpgradeReturnTo } from '@declutrmail/shared/contracts/app-navigation';
// /billing — current plan + plan comparison + change/cancel flows
// (D119, D120, D121; tiers per D17–D21, gating context D77/D81).
//
// Thin route shell — layout, data fetching, and the designed states
// (billing-disabled 503, loading, error) live in `BillingScreen` so
// they can be exercised by tests and Storybook without the router.
//
// Invoices stream on this same boundary. A nested Suspense that awaited
// its own hydration boundary painted the invoice list on the server and
// the empty fallback on the client (React hydration error #418).

import type { BillingInvoiceList } from '@declutrmail/shared/contracts';

import { headers } from 'next/headers';

import { BillingScreen } from '@/features/billing/billing-screen';
import { BillingInvoiceHistoryGate } from '@/features/billing/billing-invoice-history-gate';
import {
  billingInvoicesQueryOptions,
  billingSubscriptionQueryOptions,
} from '@/features/billing/api/query-options';
import { parseBillingInvoices } from '@/features/billing/api/parse-payload';
import { getServerBillingSubscription } from '@/features/billing/api/server-billing';
import { parseBillingIntentParams } from '@/features/billing/parse-billing-intent';
import { defaultProviderForCountry } from '@/features/billing/billing-region';
import { isPricingV2 } from '@declutrmail/shared/entitlements';
import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import { ServerApiError, serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { COUNTRY_HEADER } from '@/middleware';

const EMPTY_INVOICES: BillingInvoiceList = {
  invoices: [],
  unavailableProviders: [],
  omittedRows: 0,
  truncated: false,
};

export const metadata = {
  title: 'Billing — DeclutrMail',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [requestHeaders, params] = await Promise.all([headers(), searchParams]);
  const initialIntent = parseBillingIntentParams(params);
  // Geo is resolved at the edge and read HERE (server) so the picker
  // renders the right rail on first paint — a client-side guess would
  // flash the wrong currency before correcting itself.
  const country = requestHeaders.get(COUNTRY_HEADER);
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const eligible = hasServerAccessCookie(cookieHeader);
  // The hydration smoke sets this cookie so the server paints the loading
  // placeholder while the browser is handed a 503. Production has no
  // E2E_ISOLATED, so the cookie does nothing there.
  const e2eBillingDark =
    process.env.E2E_ISOLATED === '1' &&
    cookieHeader.split(';').some((part) => part.trim() === 'dm_e2e_billing_dark=1');
  return (
    <ServerQueryHydration
      surface="billing"
      prefetch={(queryClient) =>
        !eligible
          ? []
          : [
              queryClient.fetchQuery(
                billingSubscriptionQueryOptions(() =>
                  e2eBillingDark
                    ? Promise.reject(
                        new ServerApiError(
                          503,
                          { error: { code: 'BILLING_DISABLED' } },
                          'Billing is not available yet.',
                        ),
                      )
                    : getServerBillingSubscription(cookieHeader),
                ),
              ),
            ]
      }
      streamPrefetch={(queryClient) =>
        !eligible
          ? []
          : [
              queryClient.fetchQuery(
                billingInvoicesQueryOptions(async (signal) => {
                  const subscription = await getServerBillingSubscription(cookieHeader);
                  if (subscription.subscription == null) return EMPTY_INVOICES;
                  return parseBillingInvoices(
                    await serverGet<unknown>('/api/billing/invoices', cookieHeader, signal),
                  );
                }),
              ),
            ]
      }
    >
      <BillingScreen
        initialIntent={initialIntent}
        returnTo={parseUpgradeReturnTo(params.from)}
        initialProvider={defaultProviderForCountry(country)}
        pricingV2={isPricingV2()}
        country={country}
        invoiceHistory={<BillingInvoiceHistoryGate />}
      />
    </ServerQueryHydration>
  );
}
