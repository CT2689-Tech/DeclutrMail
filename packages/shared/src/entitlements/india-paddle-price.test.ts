import { describe, expect, it } from 'vitest';

import { inrNewPurchasePaused } from '../contracts/billing-availability';
import {
  SANDBOX_INDIA_PRICE_IDS,
  indiaPaddlePriceId,
  indiaPaddlePricesConfigured,
  selectPaddleCheckoutPrice,
} from './pricing.config';

const USD = 'pri_usd_plus';

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...extra } as NodeJS.ProcessEnv;
}

describe('India Paddle price selection', () => {
  it('uses the sandbox catalog India id and INR only for a trusted IN country', () => {
    const sandbox = env({
      PADDLE_ENV: 'sandbox',
      PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID: 'pri_ignored',
      PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID: 'pri_live_plus',
    });
    expect(indiaPaddlePriceId(sandbox, 'plus_annual')).toBe(SANDBOX_INDIA_PRICE_IDS.plus_annual);
    expect(indiaPaddlePriceId(sandbox, 'pass_onetime')).toBe(SANDBOX_INDIA_PRICE_IDS.pass_onetime);
    expect(indiaPaddlePricesConfigured(sandbox)).toBe(true);
    expect(
      selectPaddleCheckoutPrice(sandbox, {
        usdPriceId: USD,
        code: 'plus_annual',
        trustedCountry: 'IN',
      }),
    ).toEqual({ priceId: SANDBOX_INDIA_PRICE_IDS.plus_annual, currency: 'INR' });
    expect(
      selectPaddleCheckoutPrice(sandbox, {
        usdPriceId: USD,
        code: 'plus_annual',
        trustedCountry: 'US',
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
    expect(
      selectPaddleCheckoutPrice(sandbox, {
        usdPriceId: USD,
        code: 'other',
        trustedCountry: 'IN',
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
    expect(
      selectPaddleCheckoutPrice(sandbox, {
        usdPriceId: USD,
        code: 'plus_annual',
        trustedCountry: null,
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
  });

  it('falls back to USD when the live India ids are missing', () => {
    expect(
      selectPaddleCheckoutPrice(env({ PADDLE_ENV: 'production' }), {
        usdPriceId: USD,
        code: 'pass_onetime',
        trustedCountry: 'IN',
      }),
    ).toEqual({ priceId: USD, currency: 'USD' });
    expect(indiaPaddlePriceId(env({ PADDLE_ENV: 'production' }), 'plus_annual')).toBeNull();
    expect(indiaPaddlePricesConfigured(env({}))).toBe(false);
    const live = env({
      PADDLE_ENV: 'production',
      PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID: 'pri_live_plus',
      PADDLE_LIVE_INDIA_PASS_PRICE_ID: 'pri_live_pass',
    });
    expect(indiaPaddlePriceId(live, 'pass_onetime')).toBe('pri_live_pass');
    expect(indiaPaddlePricesConfigured(live)).toBe(true);
    expect(inrNewPurchasePaused('paddle', 'INR', false)).toBe(true);
    expect(inrNewPurchasePaused('paddle', 'INR', true)).toBe(false);
    expect(inrNewPurchasePaused('paddle', 'USD', false)).toBe(false);
    expect(inrNewPurchasePaused('razorpay', 'INR', true)).toBe(true);
  });
});
