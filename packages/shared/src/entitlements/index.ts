// @declutrmail/shared/entitlements — the D19 tier manifest + resolvers.
//
// A non-React module (pure TS) so the NestJS api + BullMQ workers can
// import the entitlement model without pulling the component tree.
// Composes with @declutrmail/shared/actions (ACTION_REGISTRY) — see the
// seam contract in types.ts.

export {
  COUNTS_AS_CLEANUP,
  INBOXES,
  LEGACY_PRICE_IDS,
  METER,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  POLICY,
  PRICING_VERSION,
  PROMO,
  PROMO_DISCOUNT_IDS,
  RAILS,
  SELECTOR_CAPS,
  SELECTOR_TIERS,
  TIER_MANIFEST,
  usablePriceId,
} from './pricing.config';
export type { LegacyPrice } from './pricing.config';
export {
  buildOffersJsonLd,
  connectionTerm,
  fillStory,
  fillStoryList,
  freeAllowanceLine,
  inboxLimitReachedMessage,
  indiaFaqAnswer,
  isBillingPassEnabled,
  isMeterV2,
  isPricingV2,
  meterChipLine,
  meterNoun,
  meterPreviewText,
  moneyAmount,
  passAmount,
  passEndLabel,
  planName,
  plusAmount,
  plusConnectCta,
  plusInboxLimitTitle,
  priceLine,
  pricePromiseLines,
  proNotPurchasableMessage,
  proWaitlistCta,
  proWaitlistJoined,
  promoBanner,
  promoEndLabel,
  storyValues,
  termsPastDue,
  quotaExceededMessage,
  quotaUnitsForEnqueue,
  refundLine,
  suggestedWindowPreset,
  WINDOW_PRESET_DAYS,
  renderPricingMarkdown,
} from './copy';
export type { ListedOfferOverride, QuotaExceededMessageInput } from './copy';
export {
  cleanupActionsPerMonthFor,
  hasCapability,
  inboxLimitFor,
  tierIsPurchasable,
  MAX_UNDO_WINDOW_DAYS,
  MIN_UNDO_WINDOW_DAYS,
  minimumTierForCapability,
  satisfiesActionTier,
  tierById,
  undoWindowDaysFor,
} from './resolve';
export { UNIFORM_UNDO_WINDOW_DAYS } from './undo-window';
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
