'use client';

/**
 * Provider checkout launcher (D117).
 *
 * Takes the `CheckoutSession` returned by `POST /api/billing/checkout`
 * and opens the provider's payment surface:
 *
 *   - Paddle (`kind: 'overlay'`): initialize Paddle.js with the
 *     publishable client token + environment from the session, then
 *     open the overlay with the price id. `customData` is passed
 *     through VERBATIM — the webhook resolves the workspace from it on
 *     first contact (the contract's hard requirement).
 *   - Razorpay (`kind: 'hosted'`): the subscription was created
 *     server-side (notes carry the workspace id); the FE navigates to
 *     the provider-hosted `shortUrl`.
 *
 * Payment success NEVER updates local state from here — the webhook is
 * the only grant path (§10 no-fake-completion). After the provider
 * surface closes, the user lands back on /billing which re-reads the
 * subscription.
 *
 * The Paddle module loader is injectable (`paddleLoader`) so component
 * tests exercise the wiring without the CDN script.
 */

import type * as PaddleJs from '@paddle/paddle-js';
import type { CheckoutSession, PaddleCheckoutSession } from '@declutrmail/shared/contracts';

type PaddleModule = typeof PaddleJs;

/** Test seam — swap the dynamic import for a stub. */
let paddleLoader: () => Promise<PaddleModule> = () => import('@paddle/paddle-js');

export function __setPaddleLoaderForTests(loader: () => Promise<PaddleModule>): void {
  paddleLoader = loader;
}

async function openPaddleOverlay(session: PaddleCheckoutSession): Promise<void> {
  const { initializePaddle } = await paddleLoader();
  const paddle = await initializePaddle({
    environment: session.environment,
    token: session.clientToken,
  });
  if (!paddle) {
    throw new Error('Paddle.js failed to initialize.');
  }
  paddle.Checkout.open({
    items: [{ priceId: session.priceId, quantity: 1 }],
    // Verbatim pass-through — webhook workspace attribution (D117).
    customData: session.customData,
  });
}

/** Open the provider surface for a checkout session. */
export async function launchCheckout(session: CheckoutSession): Promise<void> {
  if (session.provider === 'paddle') {
    await openPaddleOverlay(session);
    return;
  }
  // Razorpay hosted page — full navigation; the user returns via the
  // provider's redirect once payment completes (webhook grants).
  window.location.assign(session.shortUrl);
}
