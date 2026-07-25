/**
 * Tests for `launchCheckout` (D117) — the provider seam.
 *
 * Pins the contract-critical behaviors:
 *   - Paddle: initialize with the session's token + environment, open
 *     the overlay with the price id, and pass `customData` through
 *     VERBATIM (webhook workspace attribution depends on it).
 *   - Paddle events: `checkout.completed` / `checkout.closed` reach the
 *     caller's callbacks — and ONLY those events (the truthful
 *     post-checkout state must never fire on e.g. `checkout.loaded`).
 *   - Razorpay: open the in-page Checkout.js overlay against the
 *     server-created subscription, map handler/ondismiss onto the SAME
 *     event contract as Paddle, and fall back to the hosted `shortUrl`
 *     only when the script cannot load.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as PaddleJs from '@paddle/paddle-js';
import type { PaddleCheckoutSession, RazorpayCheckoutSession } from '@declutrmail/shared/contracts';

import { __setPaddleLoaderForTests, __setRazorpayLoaderForTests, launchCheckout } from './checkout';

const PADDLE_SESSION: PaddleCheckoutSession = {
  provider: 'paddle',
  kind: 'overlay',
  priceId: 'pri_123',
  clientToken: 'ctk_live_x',
  environment: 'sandbox',
  customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
};

const RAZORPAY_SESSION: RazorpayCheckoutSession = {
  provider: 'razorpay',
  kind: 'hosted',
  subscriptionId: 'sub_123',
  shortUrl: 'https://rzp.io/i/abc',
  keyId: 'rzp_test_key',
};

function stubPaddle() {
  const open = vi.fn();
  const initializePaddle = vi.fn(() =>
    Promise.resolve({ Checkout: { open } } as unknown as PaddleJs.Paddle),
  );
  __setPaddleLoaderForTests(() =>
    Promise.resolve({ initializePaddle } as unknown as typeof PaddleJs),
  );
  return { open, initializePaddle };
}

/** The eventCallback the launcher registered with Paddle.js. */
function registeredEventCallback(
  initializePaddle: ReturnType<typeof vi.fn>,
): (event: { name?: string }) => void {
  const options = initializePaddle.mock.calls[0]?.[0] as {
    eventCallback?: (event: { name?: string }) => void;
  };
  expect(options.eventCallback).toBeTypeOf('function');
  return options.eventCallback!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('launchCheckout', () => {
  it('paddle: initializes with token + environment and opens the overlay verbatim', async () => {
    const { open, initializePaddle } = stubPaddle();

    await launchCheckout(PADDLE_SESSION);

    expect(initializePaddle).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'sandbox',
        token: 'ctk_live_x',
      }),
    );
    expect(open).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_123', quantity: 1 }],
      customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
    });
  });

  it('paddle: routes checkout.completed / checkout.closed to the caller, nothing else', async () => {
    const { initializePaddle } = stubPaddle();
    const onCompleted = vi.fn();
    const onClosed = vi.fn();

    await launchCheckout(PADDLE_SESSION, { onCompleted, onClosed });
    const eventCallback = registeredEventCallback(initializePaddle);

    eventCallback({ name: 'checkout.loaded' });
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();

    eventCallback({ name: 'checkout.completed' });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();

    eventCallback({ name: 'checkout.closed' });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('paddle: a SECOND launch takes over the event routing (first-init-wins safety)', async () => {
    // initializePaddle is first-init-wins: the singleton eventCallback
    // must dispatch to the LATEST launch's handlers, never the stale
    // first closure (which would carry the first attempt's reservation
    // id into the second checkout's completed/closed events).
    const { initializePaddle } = stubPaddle();
    const first = { onCompleted: vi.fn(), onClosed: vi.fn() };
    const second = { onCompleted: vi.fn(), onClosed: vi.fn() };

    await launchCheckout(PADDLE_SESSION, first);
    await launchCheckout(PADDLE_SESSION, second);
    // Instance cached — the provider was initialized exactly once.
    expect(initializePaddle).toHaveBeenCalledTimes(1);
    const eventCallback = registeredEventCallback(initializePaddle);

    eventCallback({ name: 'checkout.completed' });
    eventCallback({ name: 'checkout.closed' });
    expect(first.onCompleted).not.toHaveBeenCalled();
    expect(first.onClosed).not.toHaveBeenCalled();
    expect(second.onCompleted).toHaveBeenCalledTimes(1);
    expect(second.onClosed).toHaveBeenCalledTimes(1);
  });

  it('paddle: events are optional — an eventless launch still opens the overlay', async () => {
    const { open, initializePaddle } = stubPaddle();

    await launchCheckout(PADDLE_SESSION);
    const eventCallback = registeredEventCallback(initializePaddle);

    // No callbacks registered — provider events must be a no-op, not a crash.
    expect(() => eventCallback({ name: 'checkout.completed' })).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('paddle: rejects when Paddle.js fails to initialize (caller keeps its panel open)', async () => {
    __setPaddleLoaderForTests(() =>
      Promise.resolve({
        initializePaddle: () => Promise.resolve(undefined),
      } as unknown as typeof PaddleJs),
    );

    await expect(launchCheckout(PADDLE_SESSION)).rejects.toThrow('Paddle.js failed to initialize.');
  });

  it('razorpay: opens the overlay against the server-created subscription', async () => {
    const open = vi.fn();
    // MUST be a function expression, not an arrow — the launcher calls
    // it with `new`, and arrows are not constructors.
    const ctor = vi.fn(function () {
      return { open };
    });
    __setRazorpayLoaderForTests(() => Promise.resolve(ctor as never));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    await launchCheckout(RAZORPAY_SESSION);

    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'rzp_test_key', subscription_id: 'sub_123' }),
    );
    expect(open).toHaveBeenCalledTimes(1);
    // The overlay is the point — no one-way trip to api.razorpay.com.
    expect(assign).not.toHaveBeenCalled();
  });

  it('razorpay: handler → onCompleted, and a post-success close is NOT an abandon', async () => {
    let options!: { handler: () => void; modal: { ondismiss: () => void } };
    const ctor = vi.fn(function (o: typeof options) {
      options = o;
      return { open: vi.fn() };
    });
    __setRazorpayLoaderForTests(() => Promise.resolve(ctor as never));
    const onCompleted = vi.fn();
    const onClosed = vi.fn();

    await launchCheckout(RAZORPAY_SESSION, { onCompleted, onClosed });

    options.handler();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    // Razorpay fires ondismiss when the post-payment overlay closes too;
    // reporting that as "closed without paying" would wrongly release
    // the reservation the caller is holding for a paid checkout.
    options.modal.ondismiss();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('razorpay: a dismiss WITHOUT payment reports onClosed', async () => {
    let options!: { modal: { ondismiss: () => void } };
    const ctor = vi.fn(function (o: typeof options) {
      options = o;
      return { open: vi.fn() };
    });
    __setRazorpayLoaderForTests(() => Promise.resolve(ctor as never));
    const onClosed = vi.fn();

    await launchCheckout(RAZORPAY_SESSION, { onClosed });
    options.modal.ondismiss();

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('razorpay: falls back to the hosted shortUrl when Checkout.js cannot load', async () => {
    __setRazorpayLoaderForTests(() => Promise.reject(new Error('CDN blocked')));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    // Must NOT reject — a dead Confirm button is worse than the
    // one-way hosted page, which still completes the purchase.
    await expect(launchCheckout(RAZORPAY_SESSION)).resolves.toBeUndefined();
    expect(assign).toHaveBeenCalledWith('https://rzp.io/i/abc');
  });
});
