import { describe, expect, it } from 'vitest';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { BillingCatalog, buildCatalog } from '../billing-catalog.js';

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

  it('fails closed: unprovisioned price points resolve to null', () => {
    expect(catalog.resolvePriceId('razorpay', 'plus', 'monthly')).toBeNull();
  });

  it('carries the D126 founding cap', () => {
    expect(new BillingCatalog().foundingMaxRedemptions).toBe(250);
  });
});
