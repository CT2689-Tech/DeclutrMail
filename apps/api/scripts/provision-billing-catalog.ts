/**
 * provision-billing-catalog.ts — idempotent D117 catalog provisioning
 * for Paddle (products + prices) and Razorpay (plans).
 *
 * Invoked by `.github/workflows/provision-billing-catalog.yml`
 * (workflow_dispatch; sandbox/live keys live ONLY as GH secrets) or
 * locally via `pnpm --filter @declutrmail/api provision-billing-catalog`
 * with the envs exported.
 *
 * IDEMPOTENT BY SKU: every created object carries the D117 plan code
 * (`plus_monthly` … `pro_annual_founding`) in Paddle `custom_data.sku`
 * / Razorpay `notes.sku`; the script LISTS first and only creates what
 * is missing — re-runs are no-ops that re-print the manifest patch.
 *
 * USD amounts come from `TIER_MANIFEST` (the single source of pricing
 * truth — D19). INR amounts mirror the same annual-value structure:
 * standard annual plans cost about ten monthly payments, while the
 * ₹10,999 Founding Pro offer remains meaningfully lower.
 *
 * OUTPUT: a copy-pasteable manifest patch block (tier → provider ids)
 * + the equivalent BILLING_CATALOG_JSON overlay for sandbox envs,
 * written to the job summary ($GITHUB_STEP_SUMMARY) and stdout.
 *
 * Missing creds for a provider → that provider is SKIPPED (partial
 * provisioning is fine; the run stays green so the other provider's
 * ids still land in the summary). Any API failure → exit 1.
 */

import { appendFileSync } from 'node:fs';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

const TIMEOUT_MS = 15_000;

interface PlanSpec {
  sku: string;
  tier: 'plus' | 'pro';
  name: string;
  interval: 'month' | 'year';
  usdCents: number;
  inrPaise: number;
}

/**
 * The five D117 plan codes. INR ladder: ₹749 / ₹7,499 / ₹1,599 /
 * ₹15,999 / ₹10,999.
 */
const PLANS: PlanSpec[] = [
  {
    sku: 'plus_monthly',
    tier: 'plus',
    name: 'DeclutrMail Plus (monthly)',
    interval: 'month',
    usdCents: TIER_MANIFEST.plus.prices.monthly!.usdCents,
    inrPaise: TIER_MANIFEST.plus.prices.monthly!.inrPaise,
  },
  {
    sku: 'plus_annual',
    tier: 'plus',
    name: 'DeclutrMail Plus (annual)',
    interval: 'year',
    usdCents: TIER_MANIFEST.plus.prices.annual!.usdCents,
    inrPaise: TIER_MANIFEST.plus.prices.annual!.inrPaise,
  },
  {
    sku: 'pro_monthly',
    tier: 'pro',
    name: 'DeclutrMail Pro (monthly)',
    interval: 'month',
    usdCents: TIER_MANIFEST.pro.prices.monthly!.usdCents,
    inrPaise: TIER_MANIFEST.pro.prices.monthly!.inrPaise,
  },
  {
    sku: 'pro_annual',
    tier: 'pro',
    name: 'DeclutrMail Pro (annual)',
    interval: 'year',
    usdCents: TIER_MANIFEST.pro.prices.annual!.usdCents,
    inrPaise: TIER_MANIFEST.pro.prices.annual!.inrPaise,
  },
  {
    sku: 'pro_annual_founding',
    tier: 'pro',
    name: 'DeclutrMail Founding Pro (annual, first 250)',
    interval: 'year',
    usdCents: TIER_MANIFEST.pro.promo!.annual.usdCents,
    inrPaise: TIER_MANIFEST.pro.promo!.annual.inrPaise,
  },
];

async function httpJson(
  url: string,
  opts: { method?: string; headers: Record<string, string>; body?: string },
): Promise<unknown> {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${opts.method ?? 'GET'} ${new URL(url).pathname}: ${text.slice(0, 300)}`,
    );
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------- Paddle

interface PaddleEntity {
  id: string;
  custom_data?: { sku?: string } | null;
}

async function provisionPaddle(): Promise<Record<string, string> | null> {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) {
    console.log('Paddle: PADDLE_API_KEY absent — skipped.');
    return null;
  }
  const base =
    process.env.PADDLE_ENV === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // One product per tier, keyed by custom_data.sku = tier id.
  const productList = (await httpJson(`${base}/products?status=active&per_page=200`, {
    headers,
  })) as { data: PaddleEntity[] };
  const productByTier = new Map<string, string>();
  for (const p of productList.data) {
    if (p.custom_data?.sku) productByTier.set(p.custom_data.sku, p.id);
  }
  for (const tier of ['plus', 'pro'] as const) {
    if (productByTier.has(tier)) continue;
    const created = (await httpJson(`${base}/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `DeclutrMail ${TIER_MANIFEST[tier].name}`,
        tax_category: 'saas',
        custom_data: { sku: tier },
      }),
    })) as { data: PaddleEntity };
    productByTier.set(tier, created.data.id);
    console.log(`Paddle: created product ${tier} → ${created.data.id}`);
  }

  // One price per plan code, keyed by custom_data.sku = plan code.
  const priceList = (await httpJson(`${base}/prices?status=active&per_page=200`, {
    headers,
  })) as { data: PaddleEntity[] };
  const priceBySku = new Map<string, string>();
  for (const p of priceList.data) {
    if (p.custom_data?.sku) priceBySku.set(p.custom_data.sku, p.id);
  }
  for (const plan of PLANS) {
    if (priceBySku.has(plan.sku)) {
      console.log(`Paddle: price ${plan.sku} exists → ${priceBySku.get(plan.sku)}`);
      continue;
    }
    const created = (await httpJson(`${base}/prices`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: plan.name,
        product_id: productByTier.get(plan.tier),
        unit_price: { amount: String(plan.usdCents), currency_code: 'USD' },
        billing_cycle: { interval: plan.interval, frequency: 1 },
        quantity: { minimum: 1, maximum: 1 },
        custom_data: { sku: plan.sku },
      }),
    })) as { data: PaddleEntity };
    priceBySku.set(plan.sku, created.data.id);
    console.log(`Paddle: created price ${plan.sku} → ${created.data.id}`);
  }

  return Object.fromEntries(PLANS.map((p) => [p.sku, priceBySku.get(p.sku)!]));
}

// -------------------------------------------------------------- Razorpay

interface RazorpayPlan {
  id: string;
  notes?: { sku?: string } | unknown[] | null;
}

async function provisionRazorpay(): Promise<Record<string, string> | null> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.log('Razorpay: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET absent — skipped.');
    return null;
  }
  const headers = {
    Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };

  const list = (await httpJson('https://api.razorpay.com/v1/plans?count=100', { headers })) as {
    items: RazorpayPlan[];
  };
  const planBySku = new Map<string, string>();
  for (const p of list.items) {
    const notes = p.notes;
    if (notes && !Array.isArray(notes) && typeof (notes as { sku?: string }).sku === 'string') {
      planBySku.set((notes as { sku: string }).sku, p.id);
    }
  }

  for (const plan of PLANS) {
    if (planBySku.has(plan.sku)) {
      console.log(`Razorpay: plan ${plan.sku} exists → ${planBySku.get(plan.sku)}`);
      continue;
    }
    const created = (await httpJson('https://api.razorpay.com/v1/plans', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        period: plan.interval === 'month' ? 'monthly' : 'yearly',
        interval: 1,
        item: { name: plan.name, amount: plan.inrPaise, currency: 'INR' },
        notes: { sku: plan.sku },
      }),
    })) as RazorpayPlan;
    planBySku.set(plan.sku, created.id);
    console.log(`Razorpay: created plan ${plan.sku} → ${created.id}`);
  }

  return Object.fromEntries(PLANS.map((p) => [p.sku, planBySku.get(p.sku)!]));
}

// ---------------------------------------------------------------- output

function emitSummary(
  paddle: Record<string, string> | null,
  razorpay: Record<string, string> | null,
): void {
  const id = (m: Record<string, string> | null, sku: string): string =>
    m?.[sku] ? `'${m[sku]}'` : 'null';
  const point = (sku: string): string =>
    `{ paddlePriceId: ${id(paddle, sku)}, razorpayPlanId: ${id(razorpay, sku)} }`;

  const lines = [
    `## Billing catalog provisioning — ${new Date().toISOString().slice(0, 10)} (${process.env.PADDLE_ENV === 'production' ? 'LIVE' : 'sandbox'})`,
    '',
    `Paddle: ${paddle ? 'provisioned' : 'skipped (no key)'} · Razorpay: ${razorpay ? 'provisioned' : 'skipped (no key)'}`,
    '',
    '### Manifest patch (packages/shared/src/entitlements/manifest.ts)',
    '',
    'Patch each price point with its provider ids (F3):',
    '',
    '```ts',
    `plus.prices.monthly  → ${point('plus_monthly')}`,
    `plus.prices.annual   → ${point('plus_annual')}`,
    `pro.prices.monthly   → ${point('pro_monthly')}`,
    `pro.prices.annual    → ${point('pro_annual')}`,
    `pro.promo.annual     → ${point('pro_annual_founding')}`,
    '```',
    '',
    '### Sandbox env overlay (BILLING_CATALOG_JSON)',
    '',
    '```json',
    JSON.stringify({ paddle: paddle ?? {}, razorpay: razorpay ?? {} }),
    '```',
    '',
    'INR amounts preserve the canonical annual-value structure: standard',
    'annual is about ten monthly payments; Founding Pro remains ₹10,999.',
    '',
  ];
  const summary = lines.join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

async function main(): Promise<void> {
  const paddle = await provisionPaddle();
  const razorpay = await provisionRazorpay();
  emitSummary(paddle, razorpay);
  if (!paddle && !razorpay) {
    console.log('::error::No provider credentials present — nothing provisioned.');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(
    `::error::provision-billing-catalog failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
