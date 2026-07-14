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
//   - `ActionCapability` (per verb × selector) declares the MINIMUM
//     `ActionTier` a verb requires plus `countsAsCleanup` — i.e. WHAT a
//     verb costs. That stays in ACTION_REGISTRY.
//   - This layer declares WHAT A TIER GRANTS: feature surfaces
//     (`Capability`), inbox limit, undo window, and the Free lifetime
//     cleanup quota the registry's `countsAsCleanup` flag draws down.
//
// Composition (the later enforcement unit wires this; no guards here):
// an action is permitted iff `satisfiesActionTier(workspace.tier,
// actionCapability.tier)` AND, when `countsAsCleanup` and
// `cleanupActionsLifetimeFor(tier)` is non-null, the workspace's
// lifetime counter is below that quota.

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
 *     every tier; the FREE quota (5 lifetime) lives on
 *     `cleanupActionsLifetime`, not on capability presence. Per-verb /
 *     per-selector minimum tiers stay in ACTION_REGISTRY (the seam).
 *   - `triage` — the Plus ritual (D29/D33).
 *   - `autopilot` / `brief` / `screener` / `quiet` / `snoozed` /
 *     `followups` — the Pro automation set (D19, D77).
 */
export const CAPABILITIES = [
  'senders',
  'sender-detail',
  'activity',
  'cleanup-actions',
  'triage',
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
  /** Row copy ("Coming Q3 2026" / "Contact sales"). */
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
   * Lifetime cleanup-action quota drawn down by registry verbs with
   * `countsAsCleanup: true` (the seam). `null` = unlimited. Free = 5
   * ("taste" actions, D19); every paid tier is unlimited.
   */
  readonly cleanupActionsLifetime: number | null;
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
