import { describe, expect, it } from 'vitest';

import { inrNewPurchasePaused } from '../contracts/billing-availability';
import {
  indiaPaddlePriceId,
  indiaPaddlePricesConfigured,
  selectPaddleCheckoutPrice,
} from './pricing.config';

const USD = 'pri_usd_plus';

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...extra } as NodeJS.ProcessEnv;
}

describe('India Paddle price selection', () => {
  it('uses the India id and INR only for a trusted IN country', () => {
    const configured = env({
      PADDLE_ENV: 'sandbox',
      PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID: 'pri_india_plus',
      PADDLE_SANDBOX_INDIA_PASS_PRICE_ID: 'pri_india_pass',
    });
    expect(
      selectPaddleCheckoutPrice(configured, {
        usdPriceId: USD,
        code: 'plus_annual',
        trustedCountry: 'IN',
      }),
    ).toEqual({ priceId: 'pri_india_plus', currency: 'INR' });
    expect(
      selectPaddleCheckoutPrice(configured, {
        usdPriceId: USD,
        code: 'plus_annual',
        trustedCountry: 'US',
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
    expect(
      selectPaddleCheckoutPrice(configured, {
        usdPriceId: USD,
        code: 'other',
        trustedCountry: 'IN',
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
  });

  it('falls back to USD when the India ids are missing and ignores the live slot in sandbox', () => {
    expect(
      selectPaddleCheckoutPrice(env({ PADDLE_ENV: 'production' }), {
        usdPriceId: USD,
        code: 'pass_onetime',
        trustedCountry: 'IN',
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
    const sandbox = env({
      PADDLE_ENV: 'sandbox',
      PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID: 'pri_live_plus',
      PADDLE_LIVE_INDIA_PASS_PRICE_ID: 'pri_live_pass',
    });
    expect(indiaPaddlePriceId(sandbox, 'plus_annual')).toBeNull();
    expect(indiaPaddlePricesConfigured(sandbox)).toBe(false);
    expect(inrNewPurchasePaused('paddle', 'INR', false)).toBe(true);
    expect(inrNewPurchasePaused('paddle', 'INR', true)).toBe(false);
    expect(inrNewPurchasePaused('paddle', 'USD', false)).toBe(false);
    expect(inrNewPurchasePaused('razorpay', 'INR', true)).toBe(true);
  });
});
