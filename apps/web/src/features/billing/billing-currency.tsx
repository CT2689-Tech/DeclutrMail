'use client';

/**
 * The currency every in-app price is quoted in (D117).
 *
 * WHY A CONTEXT: the surfaces that quote a price before sending someone
 * to checkout are scattered — the tier gate, the upgrade modal, the
 * Autopilot entitlement nudge, the plan strip. Each one that assumes USD
 * is a place an India-bound user reads "$19/mo" and is then charged
 * ₹1,599, so the currency has to reach all of them without threading a
 * prop through every intermediate component that does not care.
 *
 * Seeded SERVER-SIDE from the edge-resolved country so the first paint
 * is already right — a client-side guess would flash USD and correct
 * itself, which is worse than being wrong consistently.
 *
 * This is the DISPLAY default for surfaces that have no better
 * information. Anywhere a subscription record is in hand, its own
 * provider is authoritative and should be used instead: what a
 * subscriber is actually being charged is a fact, not a regional guess.
 */

import { createContext, useContext, type ReactNode } from 'react';

import type { Currency } from '@/features/marketing/pricing/pricing-model';

const BillingCurrencyContext = createContext<Currency>('USD');

export function BillingCurrencyProvider({
  currency,
  children,
}: {
  currency: Currency;
  children: ReactNode;
}) {
  return (
    <BillingCurrencyContext.Provider value={currency}>{children}</BillingCurrencyContext.Provider>
  );
}

/**
 * The regional display currency. Defaults to USD outside a provider —
 * Storybook, tests, and any non-Vercel host legitimately have no geo,
 * and the international rail is the one always provisioned.
 */
export function useBillingCurrency(): Currency {
  return useContext(BillingCurrencyContext);
}
