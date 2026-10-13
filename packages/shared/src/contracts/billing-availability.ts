import { WS1_COPY } from '../copy/launch/ws1';
import { indiaPaddlePricesConfigured } from '../entitlements/pricing.config';

/**
 * Razorpay stays closed for new purchases.
 * A Paddle rupee checkout is available only when both India price ids
 * are configured. Chintan approved option A on 2026-10-12 at 7:50 PM PT,
 * via Ops. The Live price IDs are still pending his OK. Existing
 * subscription management is unchanged.
 * Keep this module free of schemas so public pricing does not load billing validators.
 */
export const INR_CHECKOUT_PAUSED_MESSAGE = WS1_COPY['pricing.inrPaused.checkout'];

/**
 * New rupee checkout, on whichever rail would charge INR.
 * Razorpay is always paused. Paddle INR is paused until both India
 * price ids are set. `indiaConfigured` is the caller's view of that
 * (the API reads env; the browser receives the public flag).
 */
export function inrNewPurchasePaused(
  provider: 'paddle' | 'razorpay',
  currency: 'INR' | 'USD',
  indiaConfigured: boolean = indiaPaddlePricesConfigured(),
): boolean {
  if (provider === 'razorpay') return true;
  return currency === 'INR' && !indiaConfigured;
}
