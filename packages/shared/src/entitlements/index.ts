// @declutrmail/shared/entitlements — the D19 tier manifest + resolvers.
//
// A non-React module (pure TS) so the NestJS api + BullMQ workers can
// import the entitlement model without pulling the component tree.
// Composes with @declutrmail/shared/actions (ACTION_REGISTRY) — see the
// seam contract in types.ts.

export { TIER_MANIFEST } from './manifest';
export {
  cleanupActionsLifetimeFor,
  hasCapability,
  inboxLimitFor,
  minimumTierForCapability,
  satisfiesActionTier,
  tierById,
  undoWindowDaysFor,
} from './resolve';
export { CAPABILITIES, PROMO_IDS, TIER_IDS, TIER_RANK } from './types';
export type {
  Capability,
  NonPurchasableRow,
  PricePoint,
  PromoDefinition,
  PromoId,
  TierDefinition,
  TierId,
  TierManifest,
  TierPrices,
} from './types';
