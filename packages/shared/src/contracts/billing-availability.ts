import { WS1_COPY } from '../copy/launch/ws1';

/** Founder-approved pause, 2026-10-10. Reopen only after seller/invoice readiness review.
 * New INR checkout only; existing subscription management remains available.
 * Keep this module free of schemas so public pricing does not load billing validators. */
export const INR_NEW_PURCHASES_PAUSED = true;
export const INR_CHECKOUT_PAUSED_MESSAGE = WS1_COPY['pricing.inrPaused.checkout'];

/**
 * New rupee checkout, on whichever rail would charge INR.
 * Razorpay is always INR. Paddle is INR only when the quoted currency is.
 */
export function inrNewPurchasePaused(
  provider: 'paddle' | 'razorpay',
  currency: 'INR' | 'USD',
): boolean {
  return INR_NEW_PURCHASES_PAUSED && (provider === 'razorpay' || currency === 'INR');
}
