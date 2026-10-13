// @declutrmail/shared/entitlements — THE pricing config (D19).
//
// The single production edit point for prices, quota, inbox limits,
// undo windows, feature tiers, selector tiers, selector caps and
// cleanup counting. Changing any of them is a one-value edit HERE plus
// an intentional update to the pinned snapshot test — nothing else in
// the codebase carries a dollar amount, a tier limit, a quota number
// or a plan name as a literal.
//
// Catalog ids (`paddlePriceId` / `razorpayPlanId`, D117) are null until
// the catalog-provisioning unit writes the live SKU ids back into this
// file. Both providers are now LIVE-provisioned (2026-07-25) — the
// Razorpay ids here are the switch that opens India: every price surface
// clamps per point on `razorpayPlanId !== null`, so populating them is
// what makes an India visitor see (and be charged) INR.
//
// Ladder per the A3 free-tier activation decision (founder, 2026-07-26 —
// docs/execution/a3-pricing-rework-plan.md), as amended by the packaging
// decision of 2026-08-23 (founder). Prices, Founding Pro and every
// provider SKU are unchanged.
//
//   Free  — the whole manual product, metered at 50 cleanup actions
//           per month on the workspace's signup anniversary.
//   Plus  — Free + unlimited volume + the Screener + the WHOLE Autopilot,
//           unattended action included, plus the Quiet window that
//           governs it.
//   Pro   — Plus + the two attention surfaces (Brief, Follow-ups) and
//           5 connected inboxes.
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

import type { ActionTier, ActionVerb, SelectorType } from '../contracts/verb-constants';
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
 * bulk is Free per A3 (metered by the monthly cleanup quota; the bulk
 * capacity check runs inside one transaction — see
 * `ActionsService.enqueueBulkComposite`).
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

/**
 * Which verbs draw down the monthly cleanup quota. Total record. Keep
 * and Unarchive are free and unlimited — Keep is policy-only and writes
 * no `action_jobs` row, so counting it would require a write path built
 * purely for metering.
 */
export const COUNTS_AS_CLEANUP: Record<ActionVerb, boolean> = {
  keep: false,
  archive: true,
  later: true,
  unsubscribe: true,
  delete: true,
  unarchive: false,
};

/**
 * The D19 tier manifest. Team/enterprise entitlement values (inbox
 * limit, undo window, capabilities) are PROVISIONAL pro-equivalents:
 * neither tier is purchasable at launch, so the values only matter if a
 * workspace is assigned administratively — the plan's Pro feature gates
 * treat `tier ∈ {pro, team, enterprise}` as unlocked. Their real models
 * land with the Team build (waitlist ≥ 50) / Enterprise sales motion.
 */
export const TIER_MANIFEST: TierManifest = {
  free: {
    id: 'free',
    name: 'Free',
    prices: {
      // $0 — a price point so the pricing page renders the amount from
      // the manifest; no checkout SKU ever exists for $0 (ids stay null).
      monthly: { usdCents: 0, inrPaise: 0, paddlePriceId: null, razorpayPlanId: null },
      annual: null,
    },
    inboxLimit: 1,
    // 2026-08-23 — the undo window is uniform across the ladder. It is
    // the trust claim, not an upsell.
    undoWindowDays: 30,
    // A3 — 50 cleanup actions per month, resetting on the workspace's
    // signup anniversary. One unit = one sender acted upon; the counting
    // rule lives on `EntitlementsService.cleanupUnitsUsed`, driven by
    // `COUNTS_AS_CLEANUP` above.
    cleanupActionsPerMonth: 50,
    capabilities: FREE_CAPABILITIES,
    purchasable: true,
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    prices: {
      monthly: {
        usdCents: 900,
        inrPaise: 74_900,
        paddlePriceId: 'pri_01ky15axxbeeyge87f9hehw37t',
        razorpayPlanId: 'plan_THtwadiHmKTaze',
      },
      // $90/yr — 2 months free vs monthly (D19).
      annual: {
        usdCents: 9000,
        inrPaise: 749_900,
        paddlePriceId: 'pri_01ky15axzc9mz8sxw43c0wtn6h',
        razorpayPlanId: 'plan_THtwb3iWLy7qyp',
      },
    },
    inboxLimit: 1,
    undoWindowDays: 30,
    cleanupActionsPerMonth: null,
    capabilities: PLUS_CAPABILITIES,
    purchasable: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    prices: {
      monthly: {
        usdCents: 1900,
        inrPaise: 159_900,
        paddlePriceId: 'pri_01ky15ay15wqjaz0wjfnhe94vs',
        razorpayPlanId: 'plan_THtwbSxTZRClHX',
      },
      // $190/yr — 2 months free vs monthly (founder-confirmed 2026-07-14).
      annual: {
        usdCents: 19000,
        inrPaise: 1_599_900,
        paddlePriceId: 'pri_01ky15ay2p27rbevtvc0gb6qta',
        razorpayPlanId: 'plan_THtwbs4FAeqWlv',
      },
    },
    // 2026-08-23 — Pro carries 5 inboxes. Account count is the axis Pro
    // leans on now that automation sits on Plus.
    inboxLimit: 5,
    undoWindowDays: 30,
    cleanupActionsPerMonth: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: true,
    promo: {
      id: 'foundingPro',
      name: 'Founding Pro',
      // $129/yr, first 250 paying users; grants pro (its host tier)
      // capabilities. Price locked while the subscription stays active
      // (`workspaces.founding_member`).
      annual: {
        usdCents: 12900,
        inrPaise: 1_099_900,
        paddlePriceId: 'pri_01ky15ay4bj9t68bv158hwwfqw',
        razorpayPlanId: 'plan_THtwcIa7pf9HzZ',
      },
      maxRedemptions: 250,
    },
  },
  team: {
    id: 'team',
    name: 'Team',
    prices: { monthly: null, annual: null },
    inboxLimit: 5,
    undoWindowDays: 30,
    cleanupActionsPerMonth: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
    nonPurchasableRow: { kind: 'waitlist', label: 'Join the waitlist' },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    prices: { monthly: null, annual: null },
    inboxLimit: 5,
    undoWindowDays: 30,
    cleanupActionsPerMonth: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
    nonPurchasableRow: { kind: 'contact', label: 'Contact sales' },
  },
};

/** Launch pricing generation. Display and changelog read this, not a literal date. */
export const PRICING_VERSION = '2026-10-27';

/**
 * India rail switch. Hiding Razorpay does not null `razorpayPlanId`:
 * existing subscribers still resolve. `PRICING_V2` is what turns this on.
 */
export const RAILS = {
  paddle: { enabled: true },
  razorpay: { enabled: false },
} as const;

/** Connected Gmail accounts while `PRICING_V2` is on. */
export const INBOXES = { free: 1, plus: 2, pro: 5 } as const;

export const POLICY = {
  refundWindowDays: 14,
  refundOncePerCustomer: true,
  dunningDays: 14,
  refundPendingGraceDays: 7,
  overLimitInboxes: 'keep',
} as const;

/**
 * Emails-cleared meter. Enforced only while `METER_V2` is on.
 * Archive and Delete count. Undo refunds restored emails in the same period.
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
 * USD Plus, USD Pass, India Plus, and India Pass. The India ids are
 * env-specific (`indiaPaddlePriceId`). Paddle's discount `restrict_to`
 * must list those ids or a transaction that includes `discount_id`
 * fails. Sandbox discount `dsc_01m4phpp04scdes9ghqn3qps77` currently
 * lists only the two sandbox USD prices. Live stays `FILL_ME` until
 * that discount is created with all four live ids.
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

const UNPROVISIONED_PRICE_ID = 'FILL_ME';

function launchPrice(usdCents: number, paise: number, paddlePriceId: string): PricePoint {
  return {
    usdCents,
    inrPaise: paise,
    paddlePriceId,
    razorpayPlanId: null,
    listed: false,
    version: '2026-10',
    inr: { paise, taxInclusive: true },
  };
}

/** Plus annual 2026-10 ($59 / ₹1,999). */
export const PLUS_ANNUAL_2026_10 = launchPrice(5900, 199_900, 'pri_01m4qk99878y7jynh1h00jfhy8');

/** Backlog Pass config. `listed` stays false; JSON-LD does not follow the price id. */
export const OFFERS = {
  backlogPass: {
    kind: 'one_time',
    grantsTier: 'plus',
    durationDays: 30,
    stacks: 'extend',
    enabledFlag: 'BILLING_PASS_ENABLED',
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

/** Every previously-live Paddle and Razorpay id. Never archive these in Paddle. */
export const LEGACY_PRICE_IDS: Readonly<Record<string, LegacyPrice>> = {
  pri_01ky15axxbeeyge87f9hehw37t: {
    plan: 'plus_monthly',
    cycle: 'monthly',
    version: 'legacy',
    founding: false,
    usdCents: 900,
  },
  plan_THtwadiHmKTaze: {
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
  plan_THtwb3iWLy7qyp: {
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
  plan_THtwbSxTZRClHX: {
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
  plan_THtwbs4FAeqWlv: {
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
  plan_THtwcIa7pf9HzZ: {
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

const INDIA_PRICE_ENV = {
  sandbox: {
    plus_annual: 'PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID',
    pass_onetime: 'PADDLE_SANDBOX_INDIA_PASS_PRICE_ID',
  },
  live: {
    plus_annual: 'PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID',
    pass_onetime: 'PADDLE_LIVE_INDIA_PASS_PRICE_ID',
  },
} as const;

/**
 * India price id for this process's Paddle environment, or null while
 * that env var is unset or still `FILL_ME`. Sandbox and live are
 * different Paddle prices. A missing id falls back to the USD price.
 */
export function indiaPaddlePriceId(
  env: NodeJS.ProcessEnv = process.env,
  code: IndiaPriceCode,
): string | null {
  const slot = env.PADDLE_ENV === 'sandbox' ? 'sandbox' : 'live';
  return usablePriceId(env[INDIA_PRICE_ENV[slot][code]]?.trim());
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

/** PH30 id for this price, or null while live is FILL_ME or the price is outside the offer. */
export function checkoutDiscountId(
  env: NodeJS.ProcessEnv = process.env,
  priceId?: string | null,
): string | null {
  const sandbox = env.PADDLE_ENV === 'sandbox';
  const id = usableDiscountId(sandbox ? PROMO_DISCOUNT_IDS.sandbox : PROMO_DISCOUNT_IDS.live);
  if (!id) return null;
  if (priceId === undefined) return id;
  return ph30PriceIds(env).some((candidate) => candidate === priceId) ? id : null;
}
