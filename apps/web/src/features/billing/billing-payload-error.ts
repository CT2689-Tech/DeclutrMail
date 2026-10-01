/**
 * The billing read answered 200 with a payload the contract schema
 * cannot narrow. Thrown by the read hook's Zod parse; the derive layer
 * maps it to the `unknown` view state — the screen renders honest
 * ignorance instead of `TIER_MANIFEST[garbage]` or an invented price.
 */

export class BillingPayloadError extends Error {
  constructor(endpoint = 'GET /api/billing/subscription') {
    // The endpoint is part of the message so a Sentry line names WHICH
    // read broke its contract — three more billing endpoints now throw
    // this class, and an argument-less error attributed them all to the
    // subscription read (gate network 2026-08-16).
    super(`${endpoint} returned a payload outside its contract schema`);
    this.name = 'BillingPayloadError';
  }
}
