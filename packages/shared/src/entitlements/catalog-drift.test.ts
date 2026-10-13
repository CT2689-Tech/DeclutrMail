import { describe, expect, it } from 'vitest';

import {
  PROMO,
  PROMO_DISCOUNT_IDS,
  SANDBOX_INDIA_PRICE_IDS,
  SANDBOX_PROMO_EXPIRES_AT,
  checkoutDiscountId,
} from './pricing.config';
import {
  checkCatalogDrift,
  promoDiscountId,
  promoExpiresAt,
  type DriftPrice,
  type ManifestPriceCheck,
} from './catalog-drift';

const PLUS = 'pri_plus_annual_fixture';
const PASS = 'pri_pass_fixture';

const manifest: ManifestPriceCheck[] = [
  { id: PLUS, usdCents: 5900, inrPaise: 199900, taxInclusive: true },
  { id: PASS, usdCents: 1900, inrPaise: 79900, taxInclusive: true },
];

function price(overrides: Partial<DriftPrice> & Pick<DriftPrice, 'id'>): DriftPrice {
  return {
    status: 'active',
    amount: '5900',
    currencyCode: 'USD',
    inrAmount: overrides.id === PASS ? '79900' : '199900',
    taxInclusive: true,
    ...overrides,
  };
}

const cleanPrices = [price({ id: PLUS, amount: '5900' }), price({ id: PASS, amount: '1900' })];

const cleanDiscount = {
  id: 'dsc_ph30',
  status: 'active',
  percent: 30,
  restrictedPriceIds: [PLUS, PASS],
  expiresAt: PROMO.endsAt,
};

describe('checkCatalogDrift', () => {
  it('passes a clean fixture', () => {
    const report = checkCatalogDrift({
      manifest,
      paddlePrices: cleanPrices,
      discount: cleanDiscount,
      discountId: 'dsc_ph30',
      promoPriceIds: [PLUS, PASS],
    });
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('fails a missing manifest id', () => {
    const report = checkCatalogDrift({
      manifest: [{ id: 'FILL_ME', usdCents: 5900, inrPaise: null, taxInclusive: false }],
      paddlePrices: [],
      discount: cleanDiscount,
      discountId: 'dsc_ph30',
      promoPriceIds: [],
    });
    expect(report.ok).toBe(false);
    expect(report.failures.some((line) => line.startsWith('missing price id'))).toBe(true);
  });

  it('fails an amount mismatch', () => {
    const report = checkCatalogDrift({
      manifest,
      paddlePrices: [price({ id: PLUS, amount: '900' }), price({ id: PASS, amount: '1900' })],
      discount: cleanDiscount,
      discountId: 'dsc_ph30',
      promoPriceIds: [PLUS, PASS],
    });
    expect(report.failures.some((line) => line.includes('amount mismatch'))).toBe(true);
  });

  it('fails an INR override mismatch', () => {
    const report = checkCatalogDrift({
      manifest,
      paddlePrices: [price({ id: PLUS, inrAmount: '100' }), price({ id: PASS, amount: '1900' })],
      discount: cleanDiscount,
      discountId: 'dsc_ph30',
      promoPriceIds: [PLUS, PASS],
    });
    expect(report.failures.some((line) => line.includes('INR override mismatch'))).toBe(true);
  });

  it('fails an unknown active price', () => {
    const report = checkCatalogDrift({
      manifest,
      paddlePrices: [...cleanPrices, price({ id: 'pri_stranger', amount: '100', inrAmount: null })],
      discount: cleanDiscount,
      discountId: 'dsc_ph30',
      promoPriceIds: [PLUS, PASS],
    });
    expect(report.failures).toContain('unknown active price pri_stranger');
  });

  it('fails a PH30 mismatch', () => {
    const report = checkCatalogDrift({
      manifest,
      paddlePrices: cleanPrices,
      discount: { ...cleanDiscount, percent: 10, expiresAt: '2020-01-01T00:00:00Z' },
      discountId: 'dsc_ph30',
      promoPriceIds: [PLUS, PASS],
    });
    expect(report.failures.some((line) => line.includes('PH30 percent'))).toBe(true);
    expect(report.failures.some((line) => line.includes('PH30 expires_at'))).toBe(true);
  });

  it('keeps the sandbox PH30 id off the live slot', () => {
    expect(promoDiscountId({ PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv)).toBe(
      PROMO_DISCOUNT_IDS.sandbox,
    );
    expect(promoDiscountId({ PADDLE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('FILL_ME');
    expect(promoDiscountId({} as NodeJS.ProcessEnv)).toBe('FILL_ME');
    expect(checkoutDiscountId({ PADDLE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(checkoutDiscountId({} as NodeJS.ProcessEnv)).toBeNull();
    expect(checkoutDiscountId({ PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv)).toBe(
      PROMO_DISCOUNT_IDS.sandbox,
    );
    expect(promoExpiresAt({ PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv)).toBe(
      SANDBOX_PROMO_EXPIRES_AT,
    );
    expect(promoExpiresAt({ PADDLE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(PROMO.endsAt);
    expect(PROMO_DISCOUNT_IDS.live).toBe('FILL_ME');
    expect(
      checkoutDiscountId(
        { PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv,
        SANDBOX_INDIA_PRICE_IDS.plus_annual,
      ),
    ).toBe(PROMO_DISCOUNT_IDS.sandbox);
    expect(
      checkoutDiscountId(
        { PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv,
        SANDBOX_INDIA_PRICE_IDS.pass_onetime,
      ),
    ).toBe(PROMO_DISCOUNT_IDS.sandbox);
  });

  it('fails a USD-only price that still has an India override', () => {
    const report = checkCatalogDrift({
      manifest: [{ id: PLUS, usdCents: 5900, inrPaise: null, taxInclusive: false, usdOnly: true }],
      paddlePrices: [price({ id: PLUS, inrAmount: '199900' })],
      discount: null,
      discountId: 'FILL_ME',
      promoPriceIds: [],
    });
    expect(report.failures).toContain(
      'unexpected INR override pri_plus_annual_fixture: paddle 199900',
    );
  });

  it('fails an INR-native price that is still quoted in USD', () => {
    const report = checkCatalogDrift({
      manifest: [
        {
          id: 'pri_in',
          usdCents: 5900,
          inrPaise: 199900,
          taxInclusive: true,
          nativeCurrency: 'INR',
        },
      ],
      paddlePrices: [
        {
          id: 'pri_in',
          status: 'active',
          amount: '5900',
          currencyCode: 'USD',
          taxInclusive: true,
        },
      ],
      discount: null,
      discountId: 'FILL_ME',
      promoPriceIds: [],
    });
    expect(report.failures.some((line) => line.includes('amount mismatch'))).toBe(true);
    expect(report.ok).toBe(false);
  });
});
