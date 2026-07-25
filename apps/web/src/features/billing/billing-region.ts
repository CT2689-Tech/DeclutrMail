/**
 * Billing region → default payment provider (D117).
 *
 * Razorpay is the India rail (UPI, Indian cards, INR settlement);
 * Paddle is merchant-of-record everywhere else. Geo picks the DEFAULT
 * only — the provider radio stays user-controlled, because the country
 * an IP resolves to is not the country someone banks in (VPNs, travel,
 * NRI cards). A wrong guess must cost one click, never a dead end.
 *
 * Absent/unknown geo resolves to Paddle: the header only exists on
 * Vercel's edge, so local dev, tests, and any self-hosted deployment
 * legitimately have none, and the international rail is the one that is
 * always provisioned.
 */

import type { BillingProviderId } from '@declutrmail/shared/contracts';

/** ISO-3166-alpha-2 for India — the only Razorpay-routed market (D117). */
export const RAZORPAY_COUNTRY = 'IN';

/**
 * Default provider for an edge-resolved country.
 *
 * NOTE: this returns the PREFERRED provider, which may still be
 * unprovisioned — the caller clamps against the catalog (a null
 * `razorpayPlanId` means India checkout is deferred and Paddle is the
 * only live rail). Region preference and catalog availability are
 * deliberately separate questions.
 */
export function defaultProviderForCountry(country: string | null | undefined): BillingProviderId {
  return country?.toUpperCase() === RAZORPAY_COUNTRY ? 'razorpay' : 'paddle';
}
