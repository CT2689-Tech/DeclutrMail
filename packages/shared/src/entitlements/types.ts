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
//     SELECTOR_CAPS) resolves what a verb × selector COSTS.
//     `ActionCapability` values are derived from the config at
//     registry construction.
//   - This layer declares WHAT A TIER GRANTS: feature surfaces
//     (`Capability`), inbox limit and undo window. Free's monthly
//     allowance is `METER` in the pricing config.
//
// Composition (the later enforcement unit wires this; no guards here):
// an action is permitted iff `satisfiesActionTier(workspace.tier,
// actionCapability.tier)` AND, on Free, the verb's `METER.countsVerbs`
// units fit the workspace's current-period allowance.

import type { ActionTier } from '../contracts/verb-constants';

import type { TierId } from './tier-ids';
export { TIER_IDS, type TierId } from './tier-ids';

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
 *     every tier; Free's allowance lives on `METER`, not on capability
 *     presence. Per-verb / per-selector minimum tiers resolve from the
 *     pricing config.
 *   - `triage` — the core ritual (D29/D33); Free per A3.
 *   - `snoozed` — the Later apparatus; Free per A3 (follows the verb).
 *   - `autopilot` — D251. Rules may MATCH and the user approves
 *     each batch by hand. Plus and Pro. This is the capability the
 *     Autopilot read/approve surface requires.
 *   - `autopilot-active` — D251. Rules may ACT on future mail with no per-batch
 *     approval, i.e. `mode='active'`. Pro only.
 *
 *     The pair is deliberately two capabilities rather than one. A single
 *     all-in-one flag cannot express D251's split: granting it to Plus
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
  'autopilot',
  'autopilot-active',
  'brief',
  'screener',
  'quiet',
  'snoozed',
  'followups',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * One billing price point: canonical USD and INR amounts plus the Paddle
 * catalog id (no Stripe). Catalog ids per PRICE POINT,
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
  /**
   * Shown on pricing, the plan picker, JSON-LD and pricing.md.
   * Omitted means listed (today's catalog). `false` stays resolvable.
   */
  readonly listed?: boolean;
  /**
   * Local price generation. Checkout, webhooks, and entitlements match
   * `paddlePriceId`. Paddle price `custom_data` is not read.
   */
  readonly version?: string;
  /** Paddle INR amount. Tax-inclusive when set. */
  readonly inr?: { readonly paise: number; readonly taxInclusive: true };
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
  /** Connected-Gmail-account limit (`INBOXES` for the self-serve tiers). */
  readonly inboxLimit: number;
  /** Undo retention window. Interacts with D232. */
  readonly undoWindowDays: number;
  readonly capabilities: readonly Capability[];
  /**
   * `false` = team/enterprise, which have no purchase path. Pro is also
   * withheld from checkout — read `tierIsPurchasable`, not this field.
   */
  readonly purchasable: boolean;
}

/** The manifest type — one definition per tier, enforced at compile time. */
export type TierManifest = { readonly [T in TierId]: TierDefinition<T> };

// Re-exported so entitlement consumers can type the seam without also
// importing the actions subtree.
export type { ActionTier };
