// /billing — current plan + plan comparison + change/cancel flows
// (D119, D120, D121; tiers per D17–D21, gating context D77/D81).
//
// Thin route shell — layout, data fetching, and the designed states
// (billing-disabled 503, loading, error) live in `BillingScreen` so
// they can be exercised by tests and Storybook without the router.

import { headers } from 'next/headers';

import { BillingScreen } from '@/features/billing/billing-screen';
import { parseBillingIntentParams } from '@/features/billing/billing-intent';
import { defaultProviderForCountry } from '@/features/billing/billing-region';
import { COUNTRY_HEADER } from '@/middleware';

export const metadata = {
  title: 'Billing — DeclutrMail',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialIntent = parseBillingIntentParams(await searchParams);
  // Geo is resolved at the edge and read HERE (server) so the picker
  // renders the right rail on first paint — a client-side guess would
  // flash the wrong currency before correcting itself.
  const country = (await headers()).get(COUNTRY_HEADER);
  return (
    <BillingScreen
      initialIntent={initialIntent}
      initialProvider={defaultProviderForCountry(country)}
    />
  );
}
