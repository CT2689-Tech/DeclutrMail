import type { BillingCycle } from '@declutrmail/shared/contracts';

export type BillingIntent = {
  plan: 'plus' | 'pro';
  cycle: BillingCycle;
  promo?: 'foundingPro';
  from?: string;
};

/** Canonical, local-only path carried through auth and onboarding. */
export function billingIntentPath(intent: BillingIntent): string {
  const query = new URLSearchParams({ plan: intent.plan, cycle: intent.cycle });
  if (intent.promo) query.set('promo', intent.promo);
  // Always a local Billing URL; the entry parser validates this encoded
  // context before it can become a navigation destination.
  if (intent.from) query.set('from', intent.from);
  return `/billing?${query.toString()}`;
}
