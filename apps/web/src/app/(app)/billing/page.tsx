// /billing — current plan + plan comparison + change/cancel flows
// (D119, D120, D121; tiers per D17–D21, gating context D77/D81).
//
// Thin route shell — layout, data fetching, and the designed states
// (billing-disabled 503, loading, error) live in `BillingScreen` so
// they can be exercised by tests and Storybook without the router.

import { BillingScreen } from '@/features/billing/billing-screen';
import { parseBillingIntentParams } from '@/features/billing/billing-intent';

export const metadata = {
  title: 'Billing — DeclutrMail',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialIntent = parseBillingIntentParams(await searchParams);
  return <BillingScreen initialIntent={initialIntent} />;
}
