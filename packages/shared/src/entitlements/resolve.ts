// @declutrmail/shared/entitlements — pure manifest resolvers (D19).
//
// Lookup helpers over TIER_MANIFEST. Pure reads, no IO — the later
// enforcement unit (guards / 402s) calls these; nothing here enforces.

import type { ActionTier } from '../contracts/verb-constants';
import { ACTION_TIER_RANK } from '../contracts/verb-constants';
import { TIER_MANIFEST } from './pricing.config';
import { TIER_IDS, type Capability, type TierDefinition, type TierId } from './types';

/** The full manifest entry for a tier. */
export function tierById<T extends TierId>(id: T): TierDefinition<T> {
  return TIER_MANIFEST[id];
}

/** Whether a tier grants a feature surface (D19 capability buckets). */
export function hasCapability(id: TierId, capability: Capability): boolean {
  return TIER_MANIFEST[id].capabilities.includes(capability);
}

/** The first tier in the manifest ladder that grants a feature surface. */
export function minimumTierForCapability(capability: Capability): TierId {
  const tier = TIER_IDS.find((id) => hasCapability(id, capability));
  if (!tier) {
    throw new Error(`No tier grants capability: ${capability}`);
  }
  return tier;
}

/** Connected-Gmail-account limit (D19/A3: Free 1 / Plus 1 / Pro 3). */
export function inboxLimitFor(id: TierId): number {
  return TIER_MANIFEST[id].inboxLimit;
}

/** Undo retention window in days for one tier. */
export function undoWindowDaysFor(id: TierId): number {
  return TIER_MANIFEST[id].undoWindowDays;
}

/**
 * The undo window's FLOOR and CEILING across the whole ladder.
 *
 * For copy that cannot know the reader's tier — public marketing and
 * legal pages, and any in-app surface rendering before auth resolves.
 * The floor can only under-promise and the ceiling can only over-warn,
 * so both stay true under any ladder, including one that splits the
 * window again.
 *
 * They exist because the alternative kept going wrong in the same way:
 * copy hardcoded the SHAPE of a split ("N days on Free and Plus, M on
 * Pro") around correctly-derived numbers, which is how true values end
 * up inside a false sentence. Derive the reduction, not just the value.
 */
export const MIN_UNDO_WINDOW_DAYS = Math.min(
  ...TIER_IDS.map((id) => TIER_MANIFEST[id].undoWindowDays),
);
export const MAX_UNDO_WINDOW_DAYS = Math.max(
  ...TIER_IDS.map((id) => TIER_MANIFEST[id].undoWindowDays),
);

/**
 * Monthly cleanup-action quota — Free = 50/month on the signup
 * anniversary, everything else `null` (unlimited). Drawn down by verbs
 * whose `COUNTS_AS_CLEANUP` entry is true (pricing.config.ts). The
 * period itself is computed server-side (`cleanupPeriodFor`).
 */
export function cleanupActionsPerMonthFor(id: TierId): number | null {
  return TIER_MANIFEST[id].cleanupActionsPerMonth;
}

/**
 * THE seam with the Action Registry: does a workspace tier meet a verb
 * capability's minimum `ActionTier`? The registry gates verbs on
 * free/plus/pro only; team/enterprise rank AT pro (the plan's Pro
 * feature gates unlock for `tier ∈ {pro, team, enterprise}`). The
 * exhaustive switch is a compile-time never-check — adding a TierId
 * without deciding its action rank is a type error, not a silent
 * default.
 */
export function satisfiesActionTier(id: TierId, required: ActionTier): boolean {
  return actionTierRankFor(id) >= ACTION_TIER_RANK[required];
}

function actionTierRankFor(id: TierId): number {
  switch (id) {
    case 'free':
      return ACTION_TIER_RANK.free;
    case 'plus':
      return ACTION_TIER_RANK.plus;
    case 'pro':
    case 'team':
    case 'enterprise':
      return ACTION_TIER_RANK.pro;
    default:
      return assertNever(id);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled tier: ${String(value)}`);
}
