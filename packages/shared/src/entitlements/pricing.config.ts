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
import type { Capability, TierManifest } from './types';

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
