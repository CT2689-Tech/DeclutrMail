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

import type { BillingProviderId } from '@declutrmail/shared/contracts';

const RegionProviderContext = createContext<BillingProviderId>('paddle');

export function BillingCurrencyProvider({
  provider,
  children,
}: {
  provider: BillingProviderId;
  children: ReactNode;
}) {
  return (
    <RegionProviderContext.Provider value={provider}>{children}</RegionProviderContext.Provider>
  );
}

/**
 * The region's PREFERRED rail — deliberately not a resolved currency.
 *
 * Callers pass it to `quotedPlanPrice` / `currencyForPricePoint`, which
 * clamp per PRICE POINT: preferring Razorpay does not mean a given plan
 * is purchasable on it (India is deferred; every `razorpayPlanId` is
 * null today), and quoting INR for a point that checkout will charge in
 * USD is the defect this indirection exists to prevent.
 *
 * Defaults to Paddle outside a provider — Storybook, tests, and any
 * non-Vercel host legitimately have no geo.
 */
export function useRegionProvider(): BillingProviderId {
  return useContext(RegionProviderContext);
}
