'use client';

/**
 * Provider checkout launcher (D117).
 *
 * Takes the `CheckoutSession` returned by `POST /api/billing/checkout`
 * and opens the provider's payment surface:
 *
 *   - Paddle (`kind: 'overlay'`): initialize Paddle.js with the
 *     publishable client token + environment from the session. While
 *     rupee purchases are paused the overlay opens with the server
 *     transaction id only — no price id, items, or discount — because
 *     that transaction's currency is already USD. A price-id session
 *     is not opened. The optional `events` callbacks surface the
 *     overlay's own lifecycle
 *     (`checkout.completed` / `checkout.closed`) so the billing screen
 *     can render a truthful "payment processing" state.
 *   - Razorpay (`kind: 'hosted'`): the subscription was created
 *     server-side (notes carry the workspace id), then Checkout.js
 *     opens an in-page overlay against `subscriptionId` + the
 *     publishable `keyId`. Its `handler` / `modal.ondismiss` map onto
 *     the same `events` contract as Paddle, so the billing screen's
 *     "payment processing" state works identically for both providers.
 *
 * WHY THE OVERLAY, NOT `shortUrl`: Razorpay's Subscriptions API has no
 * `callback_url` — a `short_url` redirect is a ONE-WAY trip (it is
 * built for sharing a pay-link over SMS/WhatsApp), so the user pays and
 * is then stranded on api.razorpay.com with no route back into the app.
 * A loader failure stays in the app and retries the same held session.
 *
 * CSP (D175): Checkout.js is injected by this module — i.e. BY
 * ALREADY-TRUSTED BUNDLE CODE — so `strict-dynamic` propagates trust to
 * it. A static `<script src="checkout.razorpay.com/…">` tag would be
 * blocked (CSP3 ignores host-source expressions in script-src once
 * strict-dynamic is present); script-inserted scripts are not. This is
 * the same mechanism that makes `import('@paddle/paddle-js')` work, and
 * it closes the open U13 question in `middleware.ts`'s header comment.
 *
 * Payment success NEVER updates local state from here — the webhook is
 * the only grant path (§10 no-fake-completion). `onCompleted` means
 * "the provider reported the payment went through", not "the tier
 * changed"; the caller polls the subscription read until the webhook
 * lands.
 *
 * Both provider loaders are injectable (`paddleLoader` /
 * `razorpayLoader`) so component tests exercise the wiring without the
 * CDN scripts.
 */

import type { Paddle } from '@paddle/paddle-js';
import type * as PaddleJs from '@paddle/paddle-js';
import type {
  CheckoutSession,
  PaddleCheckoutSession,
  RazorpayCheckoutSession,
} from '@declutrmail/shared/contracts';
import { INR_NEW_PURCHASES_PAUSED } from '@declutrmail/shared/contracts/billing-availability';
import { usableDiscountId } from '@declutrmail/shared/entitlements';

type PaddleModule = typeof PaddleJs;
import {
  CHECKOUT_LOAD_TIMEOUT_MS,
  CheckoutLaunchError,
  withCheckoutLoadDeadline,
} from './checkout-error';
export { CheckoutLaunchError } from './checkout-error';

/** Overlay lifecycle callbacks — both providers render in-page. */
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
}

/** The slice of Razorpay Checkout.js this module drives. */
interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: (response: unknown) => void;
  modal: { ondismiss: () => void };
  theme?: { color?: string };
}
interface RazorpayInstance {
  open: () => void;
}
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Inject Checkout.js once and resolve the global constructor.
 *
 * Script-INSERTED (not parser-inserted) so `strict-dynamic` trusts it —
 * see the module header. The promise is cached so concurrent launches
 * share one script tag; a load failure clears the cache so a retry can
 * re-inject rather than latching the failure forever.
 */
function defaultRazorpayLoader(): Promise<RazorpayConstructor> {
  const existing = (window as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  return new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    const finish = (ctor?: RazorpayConstructor) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (ctor) resolve(ctor);
      else {
        script.remove();
        reject(new CheckoutLaunchError(true));
      }
    };
    const timer = setTimeout(() => finish(), CHECKOUT_LOAD_TIMEOUT_MS);
    script.onload = () => {
      const ctor = (window as { Razorpay?: RazorpayConstructor }).Razorpay;
      finish(ctor);
    };
    script.onerror = () => finish();
    document.head.appendChild(script);
  });
}

let razorpayLoader: () => Promise<RazorpayConstructor> = defaultRazorpayLoader;
let razorpayScriptPromise: Promise<RazorpayConstructor> | null = null;

export function __setRazorpayLoaderForTests(loader?: () => Promise<RazorpayConstructor>): void {
  razorpayLoader = loader ?? defaultRazorpayLoader;
  razorpayScriptPromise = null;
}

function loadRazorpay(): Promise<RazorpayConstructor> {
  razorpayScriptPromise ??= razorpayLoader().catch((err: unknown) => {
    // Do not latch the failure — a transient CDN blip must not disable
    // checkout for the rest of the session.
    razorpayScriptPromise = null;
    throw err;
  });
  return razorpayScriptPromise;
}

/**
 * Razorpay overlay. Unlike Paddle's first-init-wins singleton, a fresh
 * `new Razorpay(...)` is constructed per launch with that launch's own
 * callbacks — so there is no stale-handler class to guard against here.
 *
 * `handler` fires on a reported-successful payment; `modal.ondismiss`
 * on close (paid or not) — deliberately the SAME semantics the caller
 * already implements for Paddle, so the screen's truthful "processing"
 * state needs no provider branch.
 */
async function openRazorpayOverlay(
  session: RazorpayCheckoutSession,
  events: CheckoutEvents,
  mayOpen: () => boolean,
): Promise<void> {
  const Razorpay = await withCheckoutLoadDeadline(loadRazorpay());
  if (!mayOpen()) throw new CheckoutLaunchError(false);
  let settled = false;
  const instance = new Razorpay({
    key: session.keyId,
    subscription_id: session.subscriptionId,
    name: 'DeclutrMail',
    description: 'Subscription',
    handler: () => {
      // Payment REPORTED complete. The tier still flips only when the
      // webhook lands (§10) — this just releases the overlay.
      settled = true;
      events.onCompleted?.();
    },
    modal: {
      ondismiss: () => {
        // Razorpay fires ondismiss on a post-success close too; the
        // guard keeps that from being reported as an abandoned attempt.
        if (!settled) events.onClosed?.();
      },
    },
  });
  instance.open();
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
  if (!session.transactionId && (INR_NEW_PURCHASES_PAUSED || !session.priceId)) {
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
  const settings = checkoutSuccessSettings();
  if (session.transactionId) {
    // Currency and discount are already on the transaction. Items would
    // let Paddle localize a price that carries an INR override.
    paddleInstance.Checkout.open({ transactionId: session.transactionId, settings });
    return;
  }
  if (!session.priceId) throw new CheckoutLaunchError(false);
  const discountId = usableDiscountId(session.discountId);
  paddleInstance.Checkout.open({
    settings,
    items: [{ priceId: session.priceId, quantity: 1 }],
    // Verbatim pass-through — webhook workspace attribution (D117).
    ...(session.customData ? { customData: session.customData } : {}),
    // A FILL_ME placeholder is dropped so checkout opens at full price.
    ...(discountId ? { discountId } : {}),
  });
}

/** Open the provider surface for a checkout session. */
export async function launchCheckout(
  session: CheckoutSession,
  events: CheckoutEvents = {},
  mayOpen: () => boolean = () => true,
): Promise<void> {
  try {
    if (session.provider === 'paddle') await openPaddleOverlay(session, events, mayOpen);
    else await openRazorpayOverlay(session, events, mayOpen);
  } catch (err) {
    if (err instanceof CheckoutLaunchError) throw err;
    // Constructor/open failure has an unknown provider outcome. Keep the
    // reservation and reconciliation controls, without an automatic retry.
    throw new CheckoutLaunchError(false);
  }
}
