// @declutrmail/shared/entitlements — THE tier manifest (D19).
//
// The single configurable source of truth for the D19 ladder: prices,
// inbox limits, undo windows, the Free lifetime cleanup quota, and the
// per-tier capability sets. Re-pricing is a one-value change here —
// nothing else in the codebase carries a dollar amount or a tier limit.
//
// Catalog ids (`paddlePriceId` / `razorpayPlanId`, D117) are null until
// the catalog-provisioning unit writes the live SKU ids back into this
// file.
//
// Ladder locked by the founder's 2026-06-11 launch-buildout spec (D19,
// with D17–D21 / D77 / D81 context). The founder reconfirmed standard
// Pro at $19/mo or $190/yr on 2026-07-14; the $129/yr Founding Pro
// launch offer remains distinct.

import type { Capability, TierManifest } from './types';

/** Free-tier read surfaces + the 5-lifetime-quota cleanup pipeline (D19). */
const FREE_CAPABILITIES: readonly Capability[] = [
  'senders',
  'sender-detail',
  'activity',
  'cleanup-actions',
];

/** Plus = Free + Triage; the cleanup quota lifts to unlimited (D19). */
const PLUS_CAPABILITIES: readonly Capability[] = [...FREE_CAPABILITIES, 'triage'];

/** Pro = Plus + the automation set (D19, D77). */
const PRO_CAPABILITIES: readonly Capability[] = [
  ...PLUS_CAPABILITIES,
  'autopilot',
  'brief',
  'screener',
  'quiet',
  'snoozed',
  'followups',
];

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
    // D19 — "5 lifetime cleanup actions as taste". Drawn down by registry
    // verbs with `countsAsCleanup: true` (the Action Registry seam).
    cleanupActionsLifetime: 5,
    capabilities: FREE_CAPABILITIES,
    purchasable: true,
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    prices: {
      monthly: { usdCents: 900, inrPaise: 74_900, paddlePriceId: null, razorpayPlanId: null },
      // $90/yr — 2 months free vs monthly (D19).
      annual: { usdCents: 9000, inrPaise: 749_900, paddlePriceId: null, razorpayPlanId: null },
    },
    inboxLimit: 1,
    undoWindowDays: 7,
    cleanupActionsLifetime: null,
    capabilities: PLUS_CAPABILITIES,
    purchasable: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    prices: {
      monthly: { usdCents: 1900, inrPaise: 159_900, paddlePriceId: null, razorpayPlanId: null },
      // $190/yr — 2 months free vs monthly (founder-confirmed 2026-07-14).
      annual: { usdCents: 19000, inrPaise: 1_599_900, paddlePriceId: null, razorpayPlanId: null },
    },
    inboxLimit: 2,
    // D19 — Pro extends the undo window to 30 days.
    undoWindowDays: 30,
    cleanupActionsLifetime: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: true,
    promo: {
      id: 'foundingPro',
      name: 'Founding Pro',
      // $129/yr, first 250 paying users; grants pro (its host tier)
      // capabilities. Price locked while the subscription stays active
      // (`workspaces.founding_member`).
      annual: { usdCents: 12900, inrPaise: 1_099_900, paddlePriceId: null, razorpayPlanId: null },
      maxRedemptions: 250,
    },
  },
  team: {
    id: 'team',
    name: 'Team',
    prices: { monthly: null, annual: null },
    inboxLimit: 2,
    undoWindowDays: 30,
    cleanupActionsLifetime: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
    nonPurchasableRow: { kind: 'waitlist', label: 'Coming Q3 2026' },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    prices: { monthly: null, annual: null },
    inboxLimit: 2,
    undoWindowDays: 30,
    cleanupActionsLifetime: null,
    capabilities: PRO_CAPABILITIES,
    purchasable: false,
    nonPurchasableRow: { kind: 'contact', label: 'Contact sales' },
  },
};
