'use client';

/**
 * Provider checkout launcher (D117).
 *
 * Takes the `CheckoutSession` returned by `POST /api/billing/checkout`
 * and opens the provider's payment surface:
 *
 *   - Paddle (`kind: 'overlay'`): initialize Paddle.js with the
 *     publishable client token + environment from the session. The
 *     overlay opens with the server transaction id only — no price id,
 *     items, or discount — because that transaction's currency is
 *     already USD or INR. A price-id session is not opened. The
 *     optional `events` callbacks surface the
 *     overlay's own lifecycle
 *     (`checkout.completed` / `checkout.closed`) so the billing screen
 *     can render a truthful "payment processing" state.
 *
 * CSP (D175): Paddle.js is loaded by `import('@paddle/paddle-js')` —
 * i.e. BY ALREADY-TRUSTED BUNDLE CODE — so `strict-dynamic` propagates
 * trust to it.
 *
 * Payment success NEVER updates local state from here — the webhook is
 * the only grant path (§10 no-fake-completion). `onCompleted` means
 * "the provider reported the payment went through", not "the tier
 * changed"; the caller polls the subscription read until the webhook
 * lands.
 *
 * The Paddle loader is injectable (`paddleLoader`) so component tests
 * exercise the wiring without the CDN script.
 */

import type { Paddle } from '@paddle/paddle-js';
import type * as PaddleJs from '@paddle/paddle-js';
import type { CheckoutSession, PaddleCheckoutSession } from '@declutrmail/shared/contracts';
type PaddleModule = typeof PaddleJs;
import { CheckoutLaunchError, withCheckoutLoadDeadline } from './checkout-error';
export { CheckoutLaunchError } from './checkout-error';

/** Overlay lifecycle callbacks — the provider renders in-page. */
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
  paddleInitialization = null;
  activeEvents = {};
  activeTransactionId = null;
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
let paddleInitialization: Promise<Paddle> | null = null;
let activeEvents: CheckoutEvents = {};
let activeTransactionId: string | null = null;

/**
 * Page that already handles `checkout.completed`. The callback writes
 * the pending lock, then Paddle navigates here and the screen reads it.
 *
 * Paddle.js redirects on completion only when `settings.successUrl` is
 * set. This checkout omitted it, and the server transaction sends no
 * checkout settings. The observed completion redirect was the dashboard
 * default payment link (`https://declutrmail.com/welcome`), which has
 * no route. The dashboard value is left unchanged.
 */
export const PADDLE_CHECKOUT_SUCCESS_PATH = '/billing';

/** Absolute success URL on the page that opened checkout. */
export function paddleCheckoutSuccessUrl(pageUrl: string): string {
  let current: URL;
  try {
    current = new URL(pageUrl);
  } catch {
    throw new CheckoutLaunchError(false);
  }
  if (current.protocol !== 'https:' && current.protocol !== 'http:') {
    throw new CheckoutLaunchError(false);
  }
  return new URL(PADDLE_CHECKOUT_SUCCESS_PATH, current.origin).href;
}

function checkoutSuccessSettings(): { successUrl: string } {
  return { successUrl: paddleCheckoutSuccessUrl(window.location.href) };
}

async function openPaddleOverlay(
  session: PaddleCheckoutSession,
  events: CheckoutEvents,
  mayOpen: () => boolean,
): Promise<void> {
  if (!session.transactionId) {
    throw new CheckoutLaunchError(false);
  }
  if (!paddleInstance) {
    // A timed-out import/init may still finish. Retrying awaits the same
    // initialization; an abandoned launch never opens when it resolves late.
    paddleInitialization ??= (async () => {
      const { initializePaddle } = await paddleLoader();
      const paddle = await initializePaddle({
        environment: session.environment,
        token: session.clientToken,
        eventCallback: (event) => {
          if (activeTransactionId && event.data?.transaction_id !== activeTransactionId) return;
          if (event.name === 'checkout.completed') activeEvents.onCompleted?.();
          if (event.name === 'checkout.closed') activeEvents.onClosed?.();
        },
      });
      if (!paddle) throw new CheckoutLaunchError(true);
      return paddle;
    })().catch((err: unknown) => {
      paddleInitialization = null;
      throw err;
    });
    paddleInstance = await withCheckoutLoadDeadline(paddleInitialization);
  }
  if (!mayOpen()) throw new CheckoutLaunchError(false);
  activeEvents = events;
  activeTransactionId = session.transactionId;
  const settings = checkoutSuccessSettings();
  // Currency and discount are already on the transaction. Items would
  // let Paddle localize a price that carries an INR override.
  paddleInstance.Checkout.open({ transactionId: session.transactionId, settings });
}

/** Open the provider surface for a checkout session. */
export async function launchCheckout(
  session: CheckoutSession,
  events: CheckoutEvents = {},
  mayOpen: () => boolean = () => true,
): Promise<void> {
  try {
    await openPaddleOverlay(session, events, mayOpen);
  } catch (err) {
    if (err instanceof CheckoutLaunchError) throw err;
    // Constructor/open failure has an unknown provider outcome. Keep the
    // reservation and reconciliation controls, without an automatic retry.
    throw new CheckoutLaunchError(false);
  }
}
