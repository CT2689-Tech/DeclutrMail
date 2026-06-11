// apps/api/src/billing/billing-catalog.ts — runtime view of the D117
// price catalog.
//
// SOURCE OF TRUTH: `TIER_MANIFEST` (packages/shared/src/entitlements)
// carries the production `paddlePriceId` / `razorpayPlanId` per price
// point — null until the catalog-provisioning workflow's ids are
// patched in (founder step F3).
//
// SANDBOX OVERRIDE: sandbox catalog ids are DIFFERENT objects from the
// live ones (Paddle sandbox + Razorpay test mode have their own id
// space), and the manifest can only hold one set. `BILLING_CATALOG_JSON`
// overlays provider ids per plan code for non-production environments:
//
//   BILLING_CATALOG_JSON='{"paddle":{"plus_monthly":"pri_…"},"razorpay":{"pro_annual":"plan_…"}}'
//
// Plan codes are D117's cross-provider vocabulary: `plus_monthly`,
// `plus_annual`, `pro_monthly`, `pro_annual`, `pro_annual_founding`.
//
// Resolution is fail-closed: an unprovisioned price resolves to null
// and the checkout endpoint 503s (BILLING_NOT_PROVISIONED) — never a
// guessed SKU.

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type {
  BillingCycle,
  BillingProviderId,
  PurchasableTier,
} from '@declutrmail/shared/contracts';

/** D117 cross-provider plan codes. */
export const PLAN_CODES = [
  'plus_monthly',
  'plus_annual',
  'pro_monthly',
  'pro_annual',
  'pro_annual_founding',
] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/** One purchasable price point, fully resolved. */
export interface CatalogEntry {
  planCode: PlanCode;
  tierId: PurchasableTier;
  cycle: BillingCycle;
  /** D126 Founding Pro promo price point. */
  founding: boolean;
  usdCents: number;
  paddlePriceId: string | null;
  razorpayPlanId: string | null;
}

type Overrides = Partial<Record<BillingProviderId, Partial<Record<PlanCode, string>>>>;

function parseOverrides(raw: string | undefined): Overrides {
  if (!raw || raw.trim() === '') return {};
  // A malformed override JSON must fail LOUDLY at boot, not silently
  // strand the catalog on manifest nulls — JSON.parse throwing here is
  // intentional.
  return JSON.parse(raw) as Overrides;
}

/** Build the runtime catalog: manifest price points + env id overlay. */
export function buildCatalog(env: NodeJS.ProcessEnv = process.env): CatalogEntry[] {
  const overrides = parseOverrides(env.BILLING_CATALOG_JSON);
  const entries: CatalogEntry[] = [];

  for (const tierId of ['plus', 'pro'] as const) {
    const tier = TIER_MANIFEST[tierId];
    for (const cycle of ['monthly', 'annual'] as const) {
      const point = tier.prices[cycle];
      if (!point) continue;
      const planCode = `${tierId}_${cycle}` as PlanCode;
      entries.push({
        planCode,
        tierId,
        cycle,
        founding: false,
        usdCents: point.usdCents,
        paddlePriceId: overrides.paddle?.[planCode] ?? point.paddlePriceId,
        razorpayPlanId: overrides.razorpay?.[planCode] ?? point.razorpayPlanId,
      });
    }
  }

  const promo = TIER_MANIFEST.pro.promo;
  if (promo) {
    entries.push({
      planCode: 'pro_annual_founding',
      tierId: 'pro',
      cycle: 'annual',
      founding: true,
      usdCents: promo.annual.usdCents,
      paddlePriceId: overrides.paddle?.pro_annual_founding ?? promo.annual.paddlePriceId,
      razorpayPlanId: overrides.razorpay?.pro_annual_founding ?? promo.annual.razorpayPlanId,
    });
  }

  return entries;
}

/** The catalog read API the billing services consume. */
export class BillingCatalog {
  constructor(
    private readonly entries: CatalogEntry[] = buildCatalog(),
    /** D126 cap — injectable so tests can exercise the counter cheaply. */
    readonly foundingMaxRedemptions: number = TIER_MANIFEST.pro.promo?.maxRedemptions ?? 0,
  ) {}

  /** Forward: (tier, cycle, founding?) → provider price id or null. */
  resolvePriceId(
    provider: BillingProviderId,
    tierId: PurchasableTier,
    cycle: BillingCycle,
    founding = false,
  ): string | null {
    const entry = this.entries.find(
      (e) => e.tierId === tierId && e.cycle === cycle && e.founding === founding,
    );
    if (!entry) return null;
    return provider === 'paddle' ? entry.paddlePriceId : entry.razorpayPlanId;
  }

  /** Reverse: webhook's provider price id → catalog entry or null. */
  resolveByPriceId(provider: BillingProviderId, providerPriceId: string): CatalogEntry | null {
    return (
      this.entries.find((e) =>
        provider === 'paddle'
          ? e.paddlePriceId === providerPriceId
          : e.razorpayPlanId === providerPriceId,
      ) ?? null
    );
  }
}
