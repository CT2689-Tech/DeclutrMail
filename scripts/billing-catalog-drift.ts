/**
 * Read-only Paddle catalog drift check.
 *
 * Compares live or sandbox prices and the PH30 discount to the manifest.
 * Missing PADDLE_READONLY_API_KEY exits UNVERIFIED (non-zero). Never
 * writes to Paddle. Never prints the key.
 *
 *   PADDLE_ENV=sandbox PADDLE_READONLY_API_KEY=... pnpm tsx scripts/billing-catalog-drift.ts
 */
import {
  LEGACY_PRICE_IDS,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  TIER_MANIFEST,
  usablePriceId,
} from '../packages/shared/src/entitlements/pricing.config.js';
import {
  checkCatalogDrift,
  promoDiscountId,
  type DriftDiscount,
  type DriftPrice,
  type ManifestPriceCheck,
} from '../packages/shared/src/entitlements/catalog-drift.js';

const key = process.env.PADDLE_READONLY_API_KEY;
if (!key) {
  console.error('UNVERIFIED: PADDLE_READONLY_API_KEY is unset');
  process.exit(1);
}

const base =
  process.env.PADDLE_ENV === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

async function paddleGet<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = `${base}${path}`;
  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      console.error(`UNVERIFIED: Paddle ${path} returned ${response.status}`);
      process.exit(1);
    }
    const body = (await response.json()) as {
      data?: T[];
      meta?: { pagination?: { next?: string | null } };
    };
    rows.push(...(body.data ?? []));
    const next = body.meta?.pagination?.next;
    url = typeof next === 'string' && next.length > 0 ? next : null;
  }
  return rows;
}

type PaddlePrice = {
  id?: string;
  status?: string;
  tax_mode?: string;
  unit_price?: { amount?: string; currency_code?: string };
  unit_price_overrides?: Array<{
    country_codes?: string[];
    unit_price?: { amount?: string };
  }>;
};

type PaddleDiscount = {
  id?: string;
  status?: string;
  type?: string;
  amount?: string;
  expires_at?: string | null;
  restrict_to?: string[] | null;
};

function manifestPrices(): ManifestPriceCheck[] {
  const rows: ManifestPriceCheck[] = [];
  const push = (
    id: string | null,
    usdCents: number,
    inrPaise: number | null,
    taxInclusive: boolean,
  ) => {
    if (!id) return;
    rows.push({ id, usdCents, inrPaise, taxInclusive });
  };
  for (const tier of [TIER_MANIFEST.plus, TIER_MANIFEST.pro]) {
    for (const point of [tier.prices.monthly, tier.prices.annual]) {
      if (!point) continue;
      push(
        point.paddlePriceId,
        point.usdCents,
        point.inr?.paise ?? point.inrPaise,
        point.inr?.taxInclusive ?? false,
      );
    }
  }
  const founding = TIER_MANIFEST.pro.promo?.annual;
  if (founding) push(founding.paddlePriceId, founding.usdCents, null, false);
  push(
    PLUS_ANNUAL_2026_10.paddlePriceId,
    PLUS_ANNUAL_2026_10.usdCents,
    PLUS_ANNUAL_2026_10.inr?.paise ?? null,
    PLUS_ANNUAL_2026_10.inr?.taxInclusive ?? false,
  );
  push(
    OFFERS.backlogPass.price.paddlePriceId,
    OFFERS.backlogPass.price.usdCents,
    OFFERS.backlogPass.price.inr?.paise ?? null,
    OFFERS.backlogPass.price.inr?.taxInclusive ?? false,
  );
  for (const id of Object.keys(LEGACY_PRICE_IDS)) {
    if (rows.some((row) => row.id === id)) continue;
    const legacy = LEGACY_PRICE_IDS[id]!;
    push(id, legacy.usdCents, null, false);
  }
  return rows;
}

const prices = await paddleGet<PaddlePrice>('/prices?per_page=200');
const discounts = await paddleGet<PaddleDiscount>('/discounts?per_page=200');
const discountId = promoDiscountId();
const rawDiscount = discounts.find((row) => row.id === discountId);
const discount: DriftDiscount | null = rawDiscount?.id
  ? {
      id: rawDiscount.id,
      status: rawDiscount.status ?? 'unknown',
      percent: rawDiscount.type === 'percentage' ? Number(rawDiscount.amount) : Number.NaN,
      restrictedPriceIds: rawDiscount.restrict_to ?? [],
      expiresAt: rawDiscount.expires_at ?? null,
    }
  : null;

const paddlePrices: DriftPrice[] = prices.flatMap((row) => {
  if (!row.id || !row.unit_price?.amount || !row.unit_price.currency_code) return [];
  const inr = row.unit_price_overrides?.find((override) => override.country_codes?.includes('IN'));
  return [
    {
      id: row.id,
      status: row.status ?? 'unknown',
      amount: row.unit_price.amount,
      currencyCode: row.unit_price.currency_code,
      inrAmount: inr?.unit_price?.amount ?? null,
      taxInclusive: row.tax_mode === 'internal',
    },
  ];
});

function promoId(id: string | null): string {
  return usablePriceId(id) ?? id ?? 'FILL_ME';
}

const report = checkCatalogDrift({
  manifest: manifestPrices(),
  paddlePrices,
  discount,
  discountId,
  promoPriceIds: [
    promoId(PLUS_ANNUAL_2026_10.paddlePriceId),
    promoId(OFFERS.backlogPass.price.paddlePriceId),
  ],
});

if (!report.ok) {
  for (const failure of report.failures) console.error(failure);
  process.exit(1);
}
console.log(`catalog drift check passed (${paddlePrices.length} prices)`);
