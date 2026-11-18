import { describe, expect, it, vi } from 'vitest';

import {
  LEGACY_PRICE_IDS,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  PROMO_DISCOUNT_IDS,
  SANDBOX_PRICE_IDS,
  checkoutDiscountId,
} from '@declutrmail/shared/entitlements';

import {
  BillingCatalog,
  FOUNDING_MAX_REDEMPTIONS,
  buildCatalog,
  passPriceFromEnv,
} from '../billing-catalog.js';

/**
 * BillingCatalog (D117) — the 2026-10 Plus annual price point, legacy
 * price ids for existing subscribers, the BILLING_CATALOG_JSON sandbox
 * overlay, and fail-closed resolution.
 */

describe('buildCatalog', () => {
  it('throws loudly on malformed override JSON (never silently strands the catalog)', () => {
    expect(() => buildCatalog({ BILLING_CATALOG_JSON: '{nope' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('lists Plus annual only and still resolves every legacy price id', () => {
    const entries = buildCatalog({} as NodeJS.ProcessEnv);
    expect(entries.map((entry) => entry.planCode)).toEqual(['plus_annual']);
    expect(entries.find((entry) => entry.planCode === 'plus_annual')).toMatchObject({
      usdCents: PLUS_ANNUAL_2026_10.usdCents,
      paddlePriceId: PLUS_ANNUAL_2026_10.paddlePriceId,
      razorpayPlanId: null,
      founding: false,
    });
    const catalog = new BillingCatalog(entries);
    expect(catalog.resolvePriceId('paddle', 'plus', 'annual')).toBe(
      PLUS_ANNUAL_2026_10.paddlePriceId,
    );
    expect(catalog.resolvePriceId('paddle', 'plus', 'monthly')).toBeNull();
    expect(catalog.resolvePriceId('razorpay', 'plus', 'monthly')).toBeNull();
    expect(catalog.resolvePriceId('paddle', 'pro', 'monthly')).toBeNull();
    for (const [id, legacy] of Object.entries(LEGACY_PRICE_IDS)) {
      const provider = id.startsWith('pri_') ? 'paddle' : 'razorpay';
      expect(catalog.resolveByPriceId(provider, id)).toMatchObject({
        planCode: legacy.plan,
        founding: legacy.founding,
        usdCents: legacy.usdCents,
      });
    }
    expect(catalog.resolveByPriceId('paddle', 'pri_01ky15axxbeeyge87f9hehw37t')).toMatchObject({
      planCode: 'plus_monthly',
      cycle: 'monthly',
      usdCents: 900,
    });
    expect(catalog.resolveByPriceId('paddle', 'pri_01ky15axzc9mz8sxw43c0wtn6h')).toMatchObject({
      planCode: 'plus_annual',
      cycle: 'annual',
      usdCents: 9000,
    });
    expect(catalog.resolveByPriceId('paddle', 'pri_unknown')).toBeNull();
  });

  it('does not let a retired catalog overlay become a new checkout', () => {
    const catalog = new BillingCatalog(
      buildCatalog({
        BILLING_CATALOG_JSON: JSON.stringify({
          paddle: { plus_monthly: 'pri_should_not_sell', pro_annual_founding: 'pri_no_founding' },
          razorpay: { plus_monthly: 'plan_should_not_sell' },
        }),
      } as NodeJS.ProcessEnv),
    );
    expect(catalog.resolvePriceId('paddle', 'plus', 'monthly')).toBeNull();
    expect(catalog.resolvePriceId('razorpay', 'plus', 'monthly')).toBeNull();
    expect(catalog.resolvePriceId('paddle', 'pro', 'annual', true)).toBeNull();
    expect(catalog.resolveByPriceId('paddle', 'pri_should_not_sell')).toBeNull();
    expect(catalog.resolveByPriceId('paddle', 'pri_no_founding')).toBeNull();
  });

  it('keeps sandbox price ids on the sandbox env and the live ids on production', () => {
    const sandboxEnv = { PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv;
    const catalog = new BillingCatalog(buildCatalog(sandboxEnv), 0, passPriceFromEnv(sandboxEnv));
    expect(catalog.resolvePriceId('paddle', 'plus', 'annual')).toBe(SANDBOX_PRICE_IDS.plus_annual);
    expect(catalog.passPaddlePriceId).toBe(SANDBOX_PRICE_IDS.pass_onetime);
    expect(catalog.resolveByPriceId('paddle', SANDBOX_PRICE_IDS.plus_annual)).toMatchObject({
      planCode: 'plus_annual',
      usdCents: 5900,
    });
    expect(PLUS_ANNUAL_2026_10.paddlePriceId).toBe('pri_01m4qk99878y7jynh1h00jfhy8');
    expect(OFFERS.backlogPass.price.paddlePriceId).toBe('pri_01m4qkayqz3t54gdh9jq5b8ypq');
    expect(PROMO_DISCOUNT_IDS.live).toBe('FILL_ME');
    const activePromoTime = Date.parse('2026-10-18T12:00:00Z');
    expect(checkoutDiscountId(sandboxEnv, undefined, activePromoTime)).toBe(
      PROMO_DISCOUNT_IDS.sandbox,
    );
    expect(checkoutDiscountId(sandboxEnv, SANDBOX_PRICE_IDS.plus_annual, activePromoTime)).toBe(
      PROMO_DISCOUNT_IDS.sandbox,
    );
    expect(checkoutDiscountId(sandboxEnv, 'pri_legacy', activePromoTime)).toBeNull();

    const liveEnv = { PADDLE_ENV: 'production' } as NodeJS.ProcessEnv;
    const live = new BillingCatalog(buildCatalog(liveEnv), 0, passPriceFromEnv(liveEnv));
    expect(live.resolvePriceId('paddle', 'plus', 'annual')).toBe(PLUS_ANNUAL_2026_10.paddlePriceId);
    expect(live.passPaddlePriceId).toBe(OFFERS.backlogPass.price.paddlePriceId);
    expect(checkoutDiscountId(liveEnv)).toBeNull();
    expect(checkoutDiscountId(liveEnv, PLUS_ANNUAL_2026_10.paddlePriceId)).toBeNull();
    expect(checkoutDiscountId({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('lets BILLING_CATALOG_JSON replace the sandbox price ids', () => {
    const env = {
      PADDLE_ENV: 'sandbox',
      BILLING_CATALOG_JSON: JSON.stringify({
        paddle: { plus_annual: 'pri_override_annual', pass_onetime: 'pri_override_pass' },
      }),
    } as NodeJS.ProcessEnv;
    const catalog = new BillingCatalog(buildCatalog(env), 0, passPriceFromEnv(env));
    expect(catalog.resolvePriceId('paddle', 'plus', 'annual')).toBe('pri_override_annual');
    expect(catalog.passPaddlePriceId).toBe('pri_override_pass');
  });
});

describe('BillingCatalog resolution', () => {
  it('resolves forward and reverse, keeping a legacy founding price readable', () => {
    const catalog = new BillingCatalog(
      buildCatalog({
        BILLING_CATALOG_JSON: JSON.stringify({ paddle: { plus_annual: 'pri_a' } }),
      } as NodeJS.ProcessEnv),
    );
    expect(catalog.resolvePriceId('paddle', 'plus', 'annual')).toBe('pri_a');
    expect(catalog.resolveByPriceId('paddle', 'pri_a')).toMatchObject({
      planCode: 'plus_annual',
      founding: false,
    });
    expect(catalog.resolveByPriceId('paddle', 'pri_01ky15ay4bj9t68bv158hwwfqw')).toMatchObject({
      planCode: 'pro_annual_founding',
      tierId: 'pro',
      founding: true,
    });
    expect(catalog.resolveByPriceId('paddle', 'pri_unknown')).toBeNull();
  });

  it('fails closed: an unprovisioned price point resolves to null on BOTH rails', () => {
    // Built explicitly rather than read off the live manifest. This
    // assertion used to lean on Razorpay being unprovisioned, so the
    // go-live on 2026-07-25 turned it into a test of nothing — the
    // fail-closed guard is what protects a FUTURE tier added before its
    // SKUs exist, and it has to be provable whatever the catalog holds.
    const bare = new BillingCatalog([
      {
        planCode: 'plus_monthly',
        tierId: 'plus',
        cycle: 'monthly',
        founding: false,
        usdCents: 900,
        paddlePriceId: null,
        razorpayPlanId: null,
      },
    ]);
    expect(bare.resolvePriceId('razorpay', 'plus', 'monthly')).toBeNull();
    expect(bare.resolvePriceId('paddle', 'plus', 'monthly')).toBeNull();
  });

  it('carries the D126 founding cap for legacy founding subscriptions', () => {
    expect(FOUNDING_MAX_REDEMPTIONS).toBe(250);
    expect(new BillingCatalog().foundingMaxRedemptions).toBe(FOUNDING_MAX_REDEMPTIONS);
  });

  it('resolves the India Plus price to the 2026-10 Plus annual entry', () => {
    vi.stubEnv('PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID', 'pri_india_plus');
    vi.stubEnv('PADDLE_LIVE_INDIA_PASS_PRICE_ID', 'pri_india_pass');
    try {
      const catalog = new BillingCatalog(
        buildCatalog({ PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv),
      );
      expect(catalog.resolveByPriceId('paddle', 'pri_india_plus')).toMatchObject({
        planCode: 'plus_annual',
        usdCents: 5900,
        tierId: 'plus',
      });
      expect(catalog.resolveByPriceId('paddle', SANDBOX_PRICE_IDS.plus_annual)?.usdCents).toBe(
        5900,
      );
      expect(catalog.isPassPrice('pri_india_pass')).toBe(true);
      expect(catalog.isPassPrice('pri_not_a_pass')).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
