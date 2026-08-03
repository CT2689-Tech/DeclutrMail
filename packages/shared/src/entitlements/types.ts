// @declutrmail/shared/entitlements — tier + entitlement types (D19).
//
// Pure string-literal arrays + derived types, same discipline as
// contracts/verb-constants: no Zod, no logic, no cross-package imports,
// so the NestJS api and BullMQ workers can adopt the manifest without
// pulling the React/component tree.
//
// SEAM with the Action Registry (actions/manifest-entries.ts). The two
// layers split responsibility and MUST NOT duplicate each other:
//
//   - The registry declares only WHICH SELECTORS a verb supports; the
//     pricing config (`pricing.config.ts` — SELECTOR_TIERS,
//     SELECTOR_CAPS, COUNTS_AS_CLEANUP) resolves what a verb × selector
//     COSTS. `ActionCapability` values are derived from the config at
//     registry construction.
//   - This layer declares WHAT A TIER GRANTS: feature surfaces
//     (`Capability`), inbox limit, undo window, and the monthly
//     cleanup quota the config's `COUNTS_AS_CLEANUP` flags draw down.
//
// Composition (the later enforcement unit wires this; no guards here):
// an action is permitted iff `satisfiesActionTier(workspace.tier,
// actionCapability.tier)` AND, when `countsAsCleanup` and
// `cleanupActionsPerMonthFor(tier)` is non-null, the workspace's
// current-period counter is below that quota.

import type { ActionTier } from '../contracts/verb-constants';

/**
 * Billing tiers (D19 5-tier ladder), ordered low → high. Mirrors the
 * `workspace_tier` pg_enum (packages/db/schema/workspaces.ts) — the DB
 * enum is append-only and declared explicitly in its migration; this is
 * the shared vocabulary both sides agree on, not a code-gen source.
 *
 * The first three rungs are exactly the `ACTION_TIERS` the Action
 * Registry gates verbs on (a capability never requires team/enterprise);
 * an invariant test pins that prefix relationship.
 */
export const TIER_IDS = ['free', 'plus', 'pro', 'team', 'enterprise'] as const;
export type TierId = (typeof TIER_IDS)[number];

/** Rank for tier monotonicity checks (free < plus < pro < team < enterprise). */
export const TIER_RANK: Readonly<Record<TierId, number>> = {
  free: 0,
  plus: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

/**
 * Entitlement-gated feature surfaces (D19 capability buckets:
 * Free = see / Plus = clean / Pro = automate). Universal surfaces
 * (Onboarding / Settings / Billing) are not capabilities — every tier
 * reaches them, so gating them would be dead configuration.
 *
 *   - `senders` / `sender-detail` / `activity` — the Free read surfaces.
 *   - `cleanup-actions` — the K/A/U/L/D mutation pipeline. Present on
 *     every tier; the FREE quota (50/month, A3) lives on
 *     `cleanupActionsPerMonth`, not on capability presence. Per-verb /
 *     per-selector minimum tiers resolve from the pricing config.
 *   - `triage` — the core ritual (D29/D33); Free per A3.
 *   - `snoozed` — the Later apparatus; Free per A3 (follows the verb).
 *   - `autopilot-review` — D251. Rules may MATCH and the user approves
 *     each batch by hand. Plus and Pro. This is the capability the
 *     Autopilot read/approve surface requires.
 *   - `autopilot` — D251. Rules may ACT on future mail with no per-batch
 *     approval, i.e. `mode='active'`. Pro only.
 *
 *     The pair is deliberately two capabilities rather than one. A single
 *     `autopilot` flag cannot express D251's split: granting it to Plus
 *     would also let an `active` rule fire unattended, and withholding it
 *     would gate the very batch the Plus user just approved (the sweep
 *     gate in `autopilot-action.worker` is tier-level). Per-match
 *     provenance decides which one applies — see `modeAtMatch`.
 *   - `brief` / `screener` / `quiet` / `followups` — the rest of the
 *     automation set (D19, D77; D251 moved `screener` to Plus).
 */
export const CAPABILITIES = [
  'senders',
  'sender-detail',
  'activity',
  'cleanup-actions',
  'triage',
  'autopilot-review',
  'autopilot',
  'brief',
  'screener',
  'quiet',
  'snoozed',
  'followups',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * One billing price point: canonical USD and INR amounts plus provider
 * catalog ids
 * (D117 — Paddle + Razorpay, no Stripe). Catalog ids per PRICE POINT,
 * not per tier, because each interval is its own provider SKU (e.g.
 * `plus_monthly` and `plus_annual` are distinct Paddle prices). Ids stay
 * `null` until catalog provisioning writes them; the Free $0 point keeps
 * them `null` forever (no checkout SKU exists for $0).
 */
export interface PricePoint {
  /** Price in USD cents ($9/mo = 900). */
  readonly usdCents: number;
  /** Price in Indian paise (₹749/mo = 74_900). */
  readonly inrPaise: number;
  /** Paddle catalog price id — null until catalog provisioning (D117). */
  readonly paddlePriceId: string | null;
  /** Razorpay plan id — null until catalog provisioning (D117). */
  readonly razorpayPlanId: string | null;
}

/** Per-interval prices. `null` = the interval is not offered for the tier. */
export interface TierPrices {
  readonly monthly: PricePoint | null;
  readonly annual: PricePoint | null;
}

/** Launch promo ids. */
export const PROMO_IDS = ['foundingPro'] as const;
export type PromoId = (typeof PROMO_IDS)[number];

/**
 * A launch promo price variant (D19 launch offer). A promo grants its
 * HOST tier's capabilities — it is a price point, never a sixth tier
 * (Founding Pro members are `pro` workspaces with
 * `founding_member = true`, which locks the price while the
 * subscription stays active).
 */
export interface PromoDefinition {
  readonly id: PromoId;
  /** Display name ("Founding Pro"). */
  readonly name: string;
  /** Annual-only price point — promos have no monthly interval. */
  readonly annual: PricePoint;
  /** First-N paying users, counted across both providers (250). */
  readonly maxRedemptions: number;
}

/**
 * Pricing-page row treatment for a non-purchasable tier (D19): `team`
 * renders a waitlist row, `enterprise` a contact-sales row. Present
 * exactly when `purchasable` is false.
 */
export interface NonPurchasableRow {
  readonly kind: 'waitlist' | 'contact';
  /** Row copy ("Join the waitlist" / "Contact sales"). */
  readonly label: string;
}

/**
 * ONE manifest entry per tier — the D19 ladder, machine-readable. All
 * pricing/limit knobs live HERE (manifest.ts) so a re-price is a
 * one-value change.
 */
export interface TierDefinition<T extends TierId = TierId> {
  readonly id: T;
  /** Display name ("Free" / "Plus" / "Pro" / "Team" / "Enterprise"). */
  readonly name: string;
  readonly prices: TierPrices;
  /** Connected-Gmail-account limit (D19: Free 1 / Plus 1 / Pro 2). */
  readonly inboxLimit: number;
  /** Undo retention window (D19: 7d; Pro+ 30d). Interacts with D232. */
  readonly undoWindowDays: number;
  /**
   * Monthly cleanup-action quota drawn down by verbs whose
   * `COUNTS_AS_CLEANUP` entry is true (A3). The period is anchored on
   * the workspace's signup anniversary (`workspaces.created_at`) and
   * computed server-side. `null` = unlimited (every paid tier);
   * Free = 50/month.
   */
  readonly cleanupActionsPerMonth: number | null;
  readonly capabilities: readonly Capability[];
  /**
   * Self-serve attainable at launch: signup (free) or checkout
   * (plus/pro). `false` = team/enterprise — visible on the pricing page
   * but with no purchase path (see `nonPurchasableRow`).
   */
  readonly purchasable: boolean;
  /** Required exactly when `purchasable` is false. */
  readonly nonPurchasableRow?: NonPurchasableRow;
  /** Launch promo price variant hosted by this tier (pro: Founding Pro). */
  readonly promo?: PromoDefinition;
}

/** The manifest type — one definition per tier, enforced at compile time. */
export type TierManifest = { readonly [T in TierId]: TierDefinition<T> };

// Re-exported so entitlement consumers can type the seam without also
// importing the actions subtree.
export type { ActionTier };
