'use client';

/**
 * The visitor's price locale for every in-app price quote (D117).
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
 * charged currency is authoritative and should be used instead: what a
 * subscriber is actually being charged is a fact, not a regional guess.
 */

import { createContext, useContext, type ReactNode } from 'react';

const VisitorPriceLocaleContext = createContext<'usd' | 'inr'>('usd');

export function BillingCurrencyProvider({
  locale = 'usd',
  children,
}: {
  /** Trusted visitor locale. Defaults to USD so tests and Storybook stay dollar-priced. */
  locale?: 'usd' | 'inr';
  children: ReactNode;
}) {
  return (
    <VisitorPriceLocaleContext.Provider value={locale}>
      {children}
    </VisitorPriceLocaleContext.Provider>
  );
}

/** Display locale after the server resolved country + India checkout. */
export function useVisitorPriceLocale(): 'usd' | 'inr' {
  return useContext(VisitorPriceLocaleContext);
}
