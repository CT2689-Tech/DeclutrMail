import { describe, expect, it, vi } from 'vitest';

import {
  LEGACY_PRICE_IDS,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  PROMO_DISCOUNT_IDS,
  SANDBOX_PRICE_IDS,
  TIER_MANIFEST,
  checkoutDiscountId,
} from '@declutrmail/shared/entitlements';

import { BillingCatalog, buildCatalog, passPriceFromEnv } from '../billing-catalog.js';

/**
 * BillingCatalog (D117) — manifest-derived price points + the
 * BILLING_CATALOG_JSON sandbox overlay + fail-closed resolution.
 */

describe('buildCatalog', () => {
  it('derives all five D117 plan codes from the manifest with its USD amounts', () => {
    const entries = buildCatalog({} as NodeJS.ProcessEnv);
    expect(entries.map((e) => e.planCode).sort()).toEqual([
      'plus_annual',
      'plus_monthly',
      'pro_annual',
      'pro_annual_founding',
      'pro_monthly',
    ]);
    const founding = entries.find((e) => e.planCode === 'pro_annual_founding')!;
    expect(founding).toMatchObject({
      tierId: 'pro',
      cycle: 'annual',
      founding: true,
      usdCents: TIER_MANIFEST.pro.promo!.annual.usdCents,
    });
  });

  it('overlays BILLING_CATALOG_JSON ids over manifest nulls (sandbox use)', () => {
    const entries = buildCatalog({
      BILLING_CATALOG_JSON: JSON.stringify({
        paddle: { plus_monthly: 'pri_sbx_1' },
        razorpay: { pro_annual_founding: 'plan_sbx_9' },
      }),
    } as NodeJS.ProcessEnv);
    const catalog = new BillingCatalog(entries);
    expect(catalog.resolvePriceId('paddle', 'plus', 'monthly')).toBe('pri_sbx_1');
    expect(catalog.resolvePriceId('razorpay', 'pro', 'annual', true)).toBe('plan_sbx_9');
    // Untouched points keep the manifest value (null until F3 patches it).
    expect(catalog.resolvePriceId('paddle', 'pro', 'annual')).toBe(
      TIER_MANIFEST.pro.prices.annual!.paddlePriceId,
    );
  });

  it('throws loudly on malformed override JSON (never silently strands the catalog)', () => {
    expect(() => buildCatalog({ BILLING_CATALOG_JSON: '{nope' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('keeps the flag-off catalog identical to an env without PRICING_V2', () => {
    expect(buildCatalog({ PRICING_V2: 'false' } as NodeJS.ProcessEnv)).toEqual(
      buildCatalog({} as NodeJS.ProcessEnv),
    );
  });

  it('PRICING_V2 lists Plus annual only and still resolves every legacy price id', () => {
    const entries = buildCatalog({ PRICING_V2: 'true' } as NodeJS.ProcessEnv);
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

  it('PRICING_V2 does not let a monthly catalog overlay become a new checkout', () => {
    const catalog = new BillingCatalog(
      buildCatalog({
        PRICING_V2: 'true',
        BILLING_CATALOG_JSON: JSON.stringify({
          paddle: { plus_monthly: 'pri_should_not_sell' },
          razorpay: { plus_monthly: 'plan_should_not_sell' },
        }),
      } as NodeJS.ProcessEnv),
    );
    expect(catalog.resolvePriceId('paddle', 'plus', 'monthly')).toBeNull();
    expect(catalog.resolvePriceId('razorpay', 'plus', 'monthly')).toBeNull();
    expect(catalog.resolveByPriceId('paddle', 'pri_should_not_sell')).toBeNull();
  });

  it('keeps sandbox price ids on the sandbox env and the live ids on production', () => {
    const sandboxEnv = { PRICING_V2: 'true', PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv;
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
    expect(checkoutDiscountId(sandboxEnv)).toBe(PROMO_DISCOUNT_IDS.sandbox);
    expect(checkoutDiscountId(sandboxEnv, SANDBOX_PRICE_IDS.plus_annual)).toBe(
      PROMO_DISCOUNT_IDS.sandbox,
    );
    expect(checkoutDiscountId(sandboxEnv, 'pri_legacy')).toBeNull();

    const liveEnv = { PRICING_V2: 'true', PADDLE_ENV: 'production' } as NodeJS.ProcessEnv;
    const live = new BillingCatalog(buildCatalog(liveEnv), 0, passPriceFromEnv(liveEnv));
    expect(live.resolvePriceId('paddle', 'plus', 'annual')).toBe(PLUS_ANNUAL_2026_10.paddlePriceId);
    expect(live.passPaddlePriceId).toBe(OFFERS.backlogPass.price.paddlePriceId);
    expect(checkoutDiscountId(liveEnv)).toBeNull();
    expect(checkoutDiscountId(liveEnv, PLUS_ANNUAL_2026_10.paddlePriceId)).toBeNull();
    expect(checkoutDiscountId({} as NodeJS.ProcessEnv)).toBeNull();

    const flagsOff = buildCatalog({ PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv);
    expect(flagsOff.find((entry) => entry.planCode === 'plus_annual')?.paddlePriceId).toBe(
      TIER_MANIFEST.plus.prices.annual!.paddlePriceId,
    );
  });

  it('lets BILLING_CATALOG_JSON replace the sandbox price ids', () => {
    const env = {
      PRICING_V2: 'true',
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
  const catalog = new BillingCatalog(
    buildCatalog({
      BILLING_CATALOG_JSON: JSON.stringify({
        paddle: { plus_monthly: 'pri_a', pro_annual_founding: 'pri_f' },
      }),
    } as NodeJS.ProcessEnv),
    250,
  );

  it('resolves forward and reverse, distinguishing founding from regular pro annual', () => {
    expect(catalog.resolvePriceId('paddle', 'plus', 'monthly')).toBe('pri_a');
    expect(catalog.resolveByPriceId('paddle', 'pri_f')).toMatchObject({
      planCode: 'pro_annual_founding',
      founding: true,
    });
    expect(catalog.resolveByPriceId('paddle', 'pri_unknown')).toBeNull();
  });

  it('resolves Razorpay from the live manifest now that India is provisioned', () => {
    expect(catalog.resolvePriceId('razorpay', 'plus', 'monthly')).toBe(
      TIER_MANIFEST.plus.prices.monthly!.razorpayPlanId,
    );
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

  it('carries the D126 founding cap', () => {
    expect(new BillingCatalog().foundingMaxRedemptions).toBe(250);
  });

  it('resolves the India Plus price to the 2026-10 Plus annual entry', () => {
    vi.stubEnv('PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID', 'pri_india_plus');
    vi.stubEnv('PADDLE_LIVE_INDIA_PASS_PRICE_ID', 'pri_india_pass');
    vi.stubEnv('PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID', 'pri_india_plus');
    vi.stubEnv('PADDLE_SANDBOX_INDIA_PASS_PRICE_ID', 'pri_india_pass');
    try {
      const catalog = new BillingCatalog(
        buildCatalog({ PRICING_V2: 'true', PADDLE_ENV: 'sandbox' } as NodeJS.ProcessEnv),
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
