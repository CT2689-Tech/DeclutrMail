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
 *     first contact (the contract's hard requirement). The optional
 *     `events` callbacks surface the overlay's own lifecycle
 *     (`checkout.completed` / `checkout.closed`) so the billing screen
 *     can render a truthful "payment processing" state.
 *   - Razorpay (`kind: 'hosted'`): the subscription was created
 *     server-side (notes carry the workspace id); the FE navigates to
 *     the provider-hosted `shortUrl`. `events` never fire — the page
 *     unloads, and the return navigation remounts /billing fresh.
 *
 * Payment success NEVER updates local state from here — the webhook is
 * the only grant path (§10 no-fake-completion). `onCompleted` means
 * "the provider reported the payment went through", not "the tier
 * changed"; the caller polls the subscription read until the webhook
 * lands.
 *
 * The Paddle module loader is injectable (`paddleLoader`) so component
 * tests exercise the wiring without the CDN script.
 */

import { CheckoutEventNames, type Paddle } from '@paddle/paddle-js';
import type * as PaddleJs from '@paddle/paddle-js';
import type { CheckoutSession, PaddleCheckoutSession } from '@declutrmail/shared/contracts';

type PaddleModule = typeof PaddleJs;

/** Overlay lifecycle callbacks (Paddle only — Razorpay navigates away). */
export interface CheckoutEvents {
  /** The overlay reported `checkout.completed` — payment made; the tier
   *  grant still arrives only via the webhook. */
  onCompleted?: () => void;
  /** The overlay closed (`checkout.closed`) — with or without payment. */
  onClosed?: () => void;
}

/** Test seam — swap the dynamic import for a stub. */
let paddleLoader: () => Promise<PaddleModule> = () => import('@paddle/paddle-js');

export function __setPaddleLoaderForTests(loader: () => Promise<PaddleModule>): void {
  paddleLoader = loader;
  // Test isolation: a fresh loader means a fresh Paddle world.
  paddleInstance = null;
  activeEvents = {};
}

/**
 * Paddle.js `initializePaddle` is FIRST-INIT-WINS: calling it again
 * returns the existing instance and silently ignores the new
 * `eventCallback`. Registering per-launch closures there would route a
 * SECOND checkout's `completed`/`closed` events into the FIRST
 * launch's handlers — with the first attempt's (stale) reservation id.
 * So the instance is cached once and the singleton callback always
 * dispatches to `activeEvents`, which each launch takes over.
 */
let paddleInstance: Paddle | null = null;
let activeEvents: CheckoutEvents = {};

async function openPaddleOverlay(
  session: PaddleCheckoutSession,
  events: CheckoutEvents,
): Promise<void> {
  activeEvents = events;
  if (!paddleInstance) {
    const { initializePaddle } = await paddleLoader();
    const paddle: Paddle | undefined = await initializePaddle({
      environment: session.environment,
      token: session.clientToken,
      eventCallback: (event) => {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) activeEvents.onCompleted?.();
        if (event.name === CheckoutEventNames.CHECKOUT_CLOSED) activeEvents.onClosed?.();
      },
    });
    if (!paddle) {
      throw new Error('Paddle.js failed to initialize.');
    }
    paddleInstance = paddle;
  }
  paddleInstance.Checkout.open({
    items: [{ priceId: session.priceId, quantity: 1 }],
    // Verbatim pass-through — webhook workspace attribution (D117).
    customData: session.customData,
  });
}

/** Open the provider surface for a checkout session. */
export async function launchCheckout(
  session: CheckoutSession,
  events: CheckoutEvents = {},
): Promise<void> {
  if (session.provider === 'paddle') {
    await openPaddleOverlay(session, events);
    return;
  }
  // Razorpay hosted page — full navigation; the user returns via the
  // provider's redirect once payment completes (webhook grants).
  window.location.assign(session.shortUrl);
}
