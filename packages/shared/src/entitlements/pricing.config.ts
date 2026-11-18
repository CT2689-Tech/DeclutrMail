// @declutrmail/shared/entitlements — THE pricing config (D19).
//
// The single production edit point for prices, the Free meter, inbox
// limits, undo windows, feature tiers, selector tiers and selector caps.
// Changing any of them is a one-value edit HERE plus an intentional
// update to the pinned snapshot test — nothing else in the codebase
// carries a dollar amount, a tier limit, a quota number or a plan name
// as a literal.
//
// Live Paddle price ids are written into this file by hand. The catalog
// provisioning workflow was deleted 2026-11-17; create new Paddle products
// and prices in the Paddle dashboard.
// India pays through Paddle in INR (`indiaPaddlePriceId` below).
//
// Ladder per the 2026-10 launch pricing (founder decision "4A",
// 2026-11-17, retired the earlier monthly ladder, Founding Pro and the
// 50-cleanup-action Free limit):
//
//   Free  — the whole manual product, metered by `METER` (emails
//           cleared per signup month).
//   Plus  — Free + unlimited volume + the Screener + the WHOLE Autopilot,
//           unattended action included, plus the Quiet window that
//           governs it. Sold annually at `PLUS_ANNUAL_2026_10`.
//   Pass  — `OFFERS.backlogPass`: Plus access for a fixed window, once.
//   Pro   — Plus + the two attention surfaces (Brief, Follow-ups) and
//           more connected inboxes. Waitlist only (`tierIsPurchasable`).
//
// Retired price ids stay resolvable through `LEGACY_PRICE_IDS` so a
// refund or chargeback on an old subscription still maps to its tier.
//
// WHAT MOVED AND WHY (amends D19, D77, D98, D251):
//
//   - `autopilot-active` Pro → Plus. No vendor in the category sells a
//     find-but-don't-act tier; the precedented free/paid split is
//     act-once vs. make-it-stick, which is already the Free/Plus line.
//     Splitting again inside it left Plus as Pro-with-a-chore: a rule
//     that finds matches and then requires a human click, forever.
//   - `quiet` Pro → Plus. Quiet is not a feature, it is the GOVERNOR on
//     Autopilot — it decides when rules may act. Selling the governor a
//     tier above the thing it governs is how the upsell ended up
//     describing a feature the reader already owned. It also removes,
//     by construction, the stranded-window break a Pro→Plus downgrade
//     used to cause (see the `quiet ⊇ autopilot` invariant in
//     entitlements.test.ts — the guarantee this move rests on).
//   - Undo 7d → 30d on EVERY tier. No competitor paywalls undo, and
//     ADR-0030 names the window as a core differentiator while requiring
//     the lead claim to hold at Free. The lever was also inverted:
//     Delete already carries ~30 days of Gmail Trash at every tier, so
//     the extra days bought least on the most destructive verb.
//   - Pro inboxes 3 → 5 (team/enterprise follow). Account count is the
//     category's proven ladder axis, and it is what Pro leans on now
//     that automation sits on Plus.

import type { ActionTier, SelectorType } from '../contracts/verb-constants';
import type { Capability, PricePoint, TierManifest } from './types';

/**
 * Free = the whole manual cleanup product: read surfaces, the K/A/U/L/D
 * pipeline, Triage, and the Later apparatus (`snoozed` — the Later
 * list, recovery alert and manual wake follow the Later verb).
 */
const FREE_CAPABILITIES: readonly Capability[] = [
  'senders',
  'sender-detail',
  'activity',
  'cleanup-actions',
  'triage',
  'snoozed',
];

/**
 * Plus = Free + unlimited volume + the Screener + the whole Autopilot.
 *
 * Both Autopilot capabilities live here (2026-08-23, amending D251).
 * The pair still exists — the apply worker filters per match on
 * `modeAtMatch`, and `observe`/`active` remain a USER choice ("watch
 * first" vs. "just run it") — but the choice is no longer a price
 * point. Charging for the confident mode made caution the cheap
 * product, which contradicts a wedge built on previewing before
 * anything moves.
 *
 * `quiet` rides with them: it governs WHEN those rules may act, and a
 * governor must never sit above the thing it governs.
 */
const PLUS_CAPABILITIES: readonly Capability[] = [
  ...FREE_CAPABILITIES,
  'screener',
  'autopilot',
  'autopilot-active',
  'quiet',
];

/** Pro = Plus + the two attention surfaces (D19, amended 2026-08-23). */
const PRO_CAPABILITIES: readonly Capability[] = [...PLUS_CAPABILITIES, 'brief', 'followups'];

/**
 * Which tier unlocks each action SELECTOR. Total record — adding a
 * selector without deciding its tier is a compile error. Multi-sender
 * bulk is Free per A3 (metered by `METER`; the bulk capacity check runs
 * inside one transaction — see `ActionsService.enqueueBulkComposite`).
 */
export const SELECTOR_TIERS: Record<SelectorType, ActionTier> = {
  sender: 'free',
  'multi-sender': 'free',
  'sender-filter': 'pro',
};

/** Per-selector batch ceiling (D-Q1: 1000 senders per bulk click). */
export const SELECTOR_CAPS: Partial<Record<SelectorType, number>> = {
  'multi-sender': 1000,
};

/** Connected Gmail accounts per self-serve tier. */
export const INBOXES = { free: 1, plus: 2, pro: 5 } as const;

/**
 * The D19 tier manifest. Team/enterprise entitlement values (inbox
 * limit, undo window, capabilities) are PROVISIONAL pro-equivalents:
 * neither tier is purchasable, so the values only matter if a workspace
 * is assigned administratively — the plan's Pro feature gates treat
 * `tier ∈ {pro, team, enterprise}` as unlocked. They stay because the
 * `workspace_tier` enum still carries both values.
 */
export const TIER_MANIFEST: TierManifest = {
  free: {
    id: 'free',
    name: 'Free',
    inboxLimit: INBOXES.free,
    // 2026-08-23 — the undo window is uniform across the ladder. It is
    // the trust claim, not an upsell.
    undoWindowDays: 30,
    capabilities: FREE_CAPABILITIES,
    purchasable: true,
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    inboxLimit: INBOXES.plus,
    undoWindowDays: 30,
    capabilities: PLUS_CAPABILITIES,
    purchasable: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    // 2026-08-23 — Pro carries 5 inboxes. Account count is the axis Pro
    // leans on now that automation sits on Plus.
    inboxLimit: INBOXES.pro,
    undoWindowDays: 30,
    capabilities: PRO_CAPABILITIES,
    purchasable: true,
  },
  team: {
    id: 'team',
    name: 'Team',
    inboxLimit: INBOXES.pro,
    undoWindowDays: 30,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    inboxLimit: INBOXES.pro,
    undoWindowDays: 30,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
  },
};

/** Catalog generation identifier. It is not a public launch or publication date. */
export const PRICING_VERSION = '2026-10-27';

export const POLICY = {
  refundWindowDays: 14,
  refundOncePerCustomer: true,
  dunningDays: 14,
  refundPendingGraceDays: 7,
  overLimitInboxes: 'keep',
} as const;

/**
 * Free's emails-cleared meter. Archive and Delete count. Undo refunds
 * restored emails in the same period.
 */
export const METER = {
  unit: 'email',
  unitLabel: { one: 'email', other: 'emails' },
  free: { limit: 1000, period: 'signup_month' },
  countsVerbs: {
    archive: true,
    delete: true,
    later: false,
    unsubscribe: false,
    keep: false,
    unarchive: false,
  },
  undoRefunds: 'restored_same_period',
} as const;

/**
 * Display-only launch code. Checkout does not pass it through.
 * `startsAt` is launch: 2026-10-27 12:01 AM PT.
 */
export const PROMO = {
  code: 'PH30',
  percentOff: 30,
  appliesTo: ['plus_annual', 'pass_onetime'],
  startsAt: '2026-10-27T07:01:00Z',
  endsAt: '2026-11-04T07:59:00Z',
} as const;

/**
 * Paddle discount ids for PH30. Sandbox is provisioned. Live stays
 * `FILL_ME` until the launch discount is created. Checkout omits that
 * placeholder and charges the price with no discount.
 * Sandbox expiry is 2026-10-19 23:59 UTC. Live uses `PROMO.endsAt`.
 *
 * PH30 has to allow every launch price that checkout can send:
 * USD Plus, USD Pass, India Plus, and India Pass. Sandbox India ids
 * are `SANDBOX_INDIA_PRICE_IDS`. Live India ids are
 * `pri_01m4ss0bccahnyghv26rgs36xk` (Plus, product
 * `pro_01ky15axpvfkvnkj6pbbg7gfj1`) and
 * `pri_01m4ss18n1c9r5s9p973tef9v2` (Pass, product
 * `pro_01m4qkac2hde0tqvmrvt0tnbhb`). Paddle's discount `restrict_to`
 * must list those ids or a transaction that includes `discount_id`
 * fails. Live stays `FILL_ME` until that discount is created at launch
 * with all four live ids.
 */
export const PROMO_DISCOUNT_IDS = {
  sandbox: 'dsc_01m4phpp04scdes9ghqn3qps77',
  live: 'FILL_ME',
} as const;

export const SANDBOX_PROMO_EXPIRES_AT = '2026-10-19T23:59:00Z';

/**
 * Sandbox Paddle price ids. Live ids stay on `PLUS_ANNUAL_2026_10`
 * and `OFFERS.backlogPass.price`. `BILLING_CATALOG_JSON` still overrides
 * these when `PADDLE_ENV=sandbox`.
 */
export const SANDBOX_PRICE_IDS = {
  plus_annual: 'pri_01m4phk06hdmmq5cw5b8aa5r2y',
  pass_onetime: 'pri_01m4phkr8yhydb76dz11b74br8',
} as const;

/**
 * Sandbox India prices on the existing Plus and Pass products.
 * The sandbox USD prices stay USD-only. Live India ids stay in env
 * (`PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID`,
 * `PADDLE_LIVE_INDIA_PASS_PRICE_ID`) so an unbound deploy still
 * falls back to USD.
 */
export const SANDBOX_INDIA_PRICE_IDS = {
  plus_annual: 'pri_01m4sjsrywj8sx5srbh16dk4jr',
  pass_onetime: 'pri_01m4sjtr7r4qxv2cyyxs8qbj1j',
} as const;

export const SANDBOX_PRODUCT_IDS = {
  plus: 'pro_01ky067agvcnc77hf635bsjn01',
  pass: 'pro_01m4phk7mrggrfyqgprpxgz1hr',
} as const;

const UNPROVISIONED_PRICE_ID = 'FILL_ME';

function launchPrice(usdCents: number, paise: number, paddlePriceId: string): PricePoint {
  return {
    usdCents,
    inrPaise: paise,
    paddlePriceId,
    // Listed in search structured data once the price id is real
    // (founder decision 2026-11-17). A placeholder id stays unlisted.
    listed: paddlePriceId !== UNPROVISIONED_PRICE_ID,
    version: '2026-10',
    inr: { paise, taxInclusive: true },
  };
}

/** Plus annual 2026-10 ($59 / ₹1,999). */
export const PLUS_ANNUAL_2026_10 = launchPrice(5900, 199_900, 'pri_01m4qk99878y7jynh1h00jfhy8');

/** Backlog Pass config. Always purchasable; JSON-LD lists it once its price id is real. */
export const OFFERS = {
  backlogPass: {
    kind: 'one_time',
    grantsTier: 'plus',
    durationDays: 30,
    stacks: 'extend',
    price: launchPrice(1900, 79_900, 'pri_01m4qkayqz3t54gdh9jq5b8ypq'),
  },
} as const;

export interface LegacyPrice {
  readonly plan: string;
  readonly cycle: 'monthly' | 'annual';
  readonly version: string;
  readonly founding: boolean;
  readonly usdCents: number;
}

/** Every previously-live Paddle id. Never archive these in Paddle. */
export const LEGACY_PRICE_IDS: Readonly<Record<string, LegacyPrice>> = {
  pri_01ky15axxbeeyge87f9hehw37t: {
    plan: 'plus_monthly',
    cycle: 'monthly',
    version: 'legacy',
    founding: false,
    usdCents: 900,
  },
  pri_01ky15axzc9mz8sxw43c0wtn6h: {
    plan: 'plus_annual',
    cycle: 'annual',
    version: 'legacy',
    founding: false,
    usdCents: 9000,
  },
  pri_01ky15ay15wqjaz0wjfnhe94vs: {
    plan: 'pro_monthly',
    cycle: 'monthly',
    version: 'legacy',
    founding: false,
    usdCents: 1900,
  },
  pri_01ky15ay2p27rbevtvc0gb6qta: {
    plan: 'pro_annual',
    cycle: 'annual',
    version: 'legacy',
    founding: false,
    usdCents: 19000,
  },
  pri_01ky15ay4bj9t68bv158hwwfqw: {
    plan: 'pro_annual_founding',
    cycle: 'annual',
    version: 'legacy',
    founding: true,
    usdCents: 12900,
  },
};

/** A placeholder id is present in config and absent from checkout. */
export function usablePriceId(id: string | null | undefined): string | null {
  if (!id || id === UNPROVISIONED_PRICE_ID) return null;
  return id;
}

/** India Paddle prices are separate ids from the USD Plus and Pass prices. */
export type IndiaPriceCode = 'plus_annual' | 'pass_onetime';

const LIVE_INDIA_PRICE_ENV = {
  plus_annual: 'PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID',
  pass_onetime: 'PADDLE_LIVE_INDIA_PASS_PRICE_ID',
} as const;

/**
 * Sandbox uses `SANDBOX_INDIA_PRICE_IDS`. Any other env, including
 * unset, reads the live env vars. Empty or `FILL_ME` falls back to USD.
 */
export function indiaPaddlePriceId(
  env: NodeJS.ProcessEnv = process.env,
  code: IndiaPriceCode,
): string | null {
  if (env.PADDLE_ENV === 'sandbox') return SANDBOX_INDIA_PRICE_IDS[code];
  return usablePriceId(env[LIVE_INDIA_PRICE_ENV[code]]?.trim());
}

/** Both India prices must be set before a rupee checkout is offered. */
export function indiaPaddlePricesConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    indiaPaddlePriceId(env, 'plus_annual') != null &&
    indiaPaddlePriceId(env, 'pass_onetime') != null
  );
}

export type PaddleCheckoutCode = IndiaPriceCode | 'other';

/**
 * USD price unless the trusted country is exactly `IN` and this
 * checkout is a launch price with an India id configured. Customer
 * country is not an input.
 */
export function selectPaddleCheckoutPrice(
  env: NodeJS.ProcessEnv,
  input: {
    usdPriceId: string;
    code: PaddleCheckoutCode;
    trustedCountry: string | null;
  },
): { priceId: string; currency: 'USD' | 'INR' } {
  if (input.trustedCountry !== 'IN' || input.code === 'other') {
    return { priceId: input.usdPriceId, currency: 'USD' };
  }
  const india = indiaPaddlePriceId(env, input.code);
  if (!india) return { priceId: input.usdPriceId, currency: 'USD' };
  return { priceId: india, currency: 'INR' };
}

/** USD launch prices plus any India ids configured for this Paddle environment. */
export function ph30PriceIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const sandbox = env.PADDLE_ENV === 'sandbox';
  const base = sandbox
    ? [SANDBOX_PRICE_IDS.plus_annual, SANDBOX_PRICE_IDS.pass_onetime]
    : [PLUS_ANNUAL_2026_10.paddlePriceId, OFFERS.backlogPass.price.paddlePriceId];
  const india = [indiaPaddlePriceId(env, 'plus_annual'), indiaPaddlePriceId(env, 'pass_onetime')];
  return [...base, ...india].filter((id): id is string => id != null);
}

/** A placeholder discount id is omitted. Checkout then charges full price. */
export function usableDiscountId(id: string | null | undefined): string | null {
  if (!id || id === UNPROVISIONED_PRICE_ID) return null;
  return id;
}

/** Omit expired or unprovisioned discounts and prices outside the offer. */
export function checkoutDiscountId(
  env: NodeJS.ProcessEnv = process.env,
  priceId?: string | null,
  nowMs: number = Date.now(),
): string | null {
  const sandbox = env.PADDLE_ENV === 'sandbox';
  const expiresAt = sandbox ? SANDBOX_PROMO_EXPIRES_AT : PROMO.endsAt;
  if (!Number.isFinite(nowMs) || nowMs >= Date.parse(expiresAt)) return null;
  const id = usableDiscountId(sandbox ? PROMO_DISCOUNT_IDS.sandbox : PROMO_DISCOUNT_IDS.live);
  if (!id) return null;
  if (priceId === undefined) return id;
  return ph30PriceIds(env).some((candidate) => candidate === priceId) ? id : null;
}
