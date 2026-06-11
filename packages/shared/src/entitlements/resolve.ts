// @declutrmail/shared/entitlements — pure manifest resolvers (D19).
//
// Lookup helpers over TIER_MANIFEST. Pure reads, no IO — the later
// enforcement unit (guards / 402s) calls these; nothing here enforces.

import type { ActionTier } from '../contracts/verb-constants';
import { ACTION_TIER_RANK } from '../contracts/verb-constants';
import { TIER_MANIFEST } from './manifest';
import type { Capability, TierDefinition, TierId } from './types';

/** The full manifest entry for a tier. */
export function tierById<T extends TierId>(id: T): TierDefinition<T> {
  return TIER_MANIFEST[id];
}

/** Whether a tier grants a feature surface (D19 capability buckets). */
export function hasCapability(id: TierId, capability: Capability): boolean {
  return TIER_MANIFEST[id].capabilities.includes(capability);
}

/** Connected-Gmail-account limit (D19: Free 1 / Plus 1 / Pro 2). */
export function inboxLimitFor(id: TierId): number {
  return TIER_MANIFEST[id].inboxLimit;
}

/** Undo retention window in days (D19: 7d; Pro+ 30d). */
export function undoWindowDaysFor(id: TierId): number {
  return TIER_MANIFEST[id].undoWindowDays;
}

/**
 * Lifetime cleanup-action quota — Free = 5, everything else `null`
 * (unlimited). Drawn down by Action Registry verbs whose selector
 * capability has `countsAsCleanup: true` (the seam with
 * actions/manifest-entries.ts).
 */
export function cleanupActionsLifetimeFor(id: TierId): number | null {
  return TIER_MANIFEST[id].cleanupActionsLifetime;
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
