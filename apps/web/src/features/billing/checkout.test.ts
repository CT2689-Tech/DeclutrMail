/**
 * Tests for `launchCheckout` (D117) — the provider seam.
 *
 * Pins the two contract-critical behaviors:
 *   - Paddle: initialize with the session's token + environment, open
 *     the overlay with the price id, and pass `customData` through
 *     VERBATIM (webhook workspace attribution depends on it).
 *   - Razorpay: navigate to the provider-hosted `shortUrl`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as PaddleJs from '@paddle/paddle-js';
import type { PaddleCheckoutSession, RazorpayCheckoutSession } from '@declutrmail/shared/contracts';

import { __setPaddleLoaderForTests, launchCheckout } from './checkout';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('launchCheckout', () => {
  it('paddle: initializes with token + environment and opens the overlay verbatim', async () => {
    const open = vi.fn();
    const initializePaddle = vi.fn(() =>
      Promise.resolve({ Checkout: { open } } as unknown as PaddleJs.Paddle),
    );
    __setPaddleLoaderForTests(() =>
      Promise.resolve({ initializePaddle } as unknown as typeof PaddleJs),
    );

    await launchCheckout(PADDLE_SESSION);

    expect(initializePaddle).toHaveBeenCalledWith({
      environment: 'sandbox',
      token: 'ctk_live_x',
    });
    expect(open).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_123', quantity: 1 }],
      customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
    });
  });

  it('paddle: rejects when Paddle.js fails to initialize (caller keeps its modal open)', async () => {
    __setPaddleLoaderForTests(() =>
      Promise.resolve({
        initializePaddle: () => Promise.resolve(undefined),
      } as unknown as typeof PaddleJs),
    );

    await expect(launchCheckout(PADDLE_SESSION)).rejects.toThrow('Paddle.js failed to initialize.');
  });

  it('razorpay: navigates to the hosted shortUrl', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await launchCheckout(RAZORPAY_SESSION);
    expect(assign).toHaveBeenCalledWith('https://rzp.io/i/abc');
  });
});
