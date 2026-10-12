import { WS1_COPY } from '../copy/launch/ws1';

/** Founder-approved pause, 2026-10-10. Reopen only after seller/invoice readiness review.
 * New INR checkout only; existing subscription management remains available.
 * Keep this module free of schemas so public pricing does not load billing validators. */
export const INR_NEW_PURCHASES_PAUSED = true;
export const INR_CHECKOUT_PAUSED_MESSAGE = WS1_COPY['pricing.inrPaused.checkout'];
