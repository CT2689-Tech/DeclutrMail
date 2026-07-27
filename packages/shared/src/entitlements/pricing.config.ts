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
// docs/execution/a3-pricing-rework-plan.md): prices, Founding Pro and
// every provider SKU unchanged; Free gains Triage + Later + bulk with a
// 50 cleanup-actions/month quota anchored on the workspace's signup
// anniversary; Plus = Free + unlimited volume; Pro adds the automation
// set, 3 inboxes and the 30-day undo window.

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

/** Plus = Free + unlimited volume — the quota is the ONLY difference. */
const PLUS_CAPABILITIES: readonly Capability[] = [...FREE_CAPABILITIES];

/** Pro = Plus + the automation set (D19, D77). */
const PRO_CAPABILITIES: readonly Capability[] = [
  ...PLUS_CAPABILITIES,
  'autopilot',
  'brief',
  'screener',
  'quiet',
  'followups',
];

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
    undoWindowDays: 7,
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
    undoWindowDays: 7,
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
    // A3 — Pro carries 3 inboxes.
    inboxLimit: 3,
    // D19 — Pro extends the undo window to 30 days.
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
    inboxLimit: 3,
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
    inboxLimit: 3,
    undoWindowDays: 30,
    cleanupActionsPerMonth: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
    nonPurchasableRow: { kind: 'contact', label: 'Contact sales' },
  },
};
