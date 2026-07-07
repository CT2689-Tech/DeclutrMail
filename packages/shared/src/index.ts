// @declutrmail/shared — design tokens, primitives, app shell, and
// external-integration contracts (D201).

export type { KmsProvider } from './contracts/index';
export type { DecodedCursor, Envelope, PaginatedEnvelope, PaginationMeta } from './contracts/index';
export { clampLimit, decodeCursor, encodeCursor, ok, paginated, withMeta } from './contracts/index';

export { tokens } from './tokens/tokens';
export type { Tokens } from './tokens/tokens';

// Branded identifiers (FOUNDER-FOLLOWUPS 2026-06-05).
export type {
  SenderId,
  MailboxId,
  UserId,
  ActionId,
  UndoToken,
  SenderKey,
  IdempotencyKey,
} from './ids/branded';
export {
  asSenderId,
  asMailboxId,
  asUserId,
  asActionId,
  asUndoToken,
  asSenderKey,
  asIdempotencyKey,
} from './ids/branded';

export { useLocalState } from './hooks/use-local-state';
export { useIsAtMost } from './hooks/use-is-at-most';
export type { Breakpoint } from './hooks/use-is-at-most';
export { useLabels } from './hooks/use-labels';
export type { LabelKey, LabelMode, LabelSet } from './hooks/use-labels';
export { useFocusTrap } from './hooks/use-focus-trap';
export { useExpandableRow, nextExpandedRowId } from './hooks/use-expandable-row';
export type { UseExpandableRowResult } from './hooks/use-expandable-row';

export { Kbd } from './components/kbd';
export { Eyebrow } from './components/eyebrow';
export type { EyebrowTone } from './components/eyebrow';
export { Pill } from './components/pill';
export type { PillTone } from './components/pill';
export { PrivacyBadge } from './components/privacy-badge';
export type { PrivacyBadgeVariant } from './components/privacy-badge';
export { Card } from './components/card';
export { Spark } from './components/spark';
export { Avatar } from './components/avatar';
export { Button } from './components/button';
export type { ButtonTone, ButtonSize } from './components/button';
export { EmptyState } from './components/empty-state';
export type {
  EmptyStateProps,
  EmptyStateTier,
  EmptyStateTierNudge,
} from './components/empty-state';
export { ScreenIntro } from './components/screen-intro';

// ADR-0016 — shared numeric primitive for Senders + Sender-Detail
// surfaces. Variants: hero / display / stat / data. Replaces ad-hoc
// `font.display` + fontSize combos at every callsite that renders a
// primary numeric. See docs/adr/0016-senders-visual-language.md.
export { NumericDisplay } from './components/numeric-display';
export type {
  NumericDisplayProps,
  NumericDisplayTone,
  NumericDisplayVariant,
} from './components/numeric-display';

// ADR-0019 — K/A/U/L/D action popover surface. Replaces hand-rolled
// verb-to-button rows on SenderCard / SenderTable / SenderDetail /
// SelectionBar. See docs/adr/0019-verb-registry-and-kauld.md.
export { ActionPopover, ActionPopoverTrigger } from './components/action-popover';
export type { ActionPopoverProps } from './components/action-popover';

// D211 — typed edge-state inventory. Enforces that every launch screen
// has designed coverage for every edge state it can enter.
export { EDGE_STATE_INVENTORY, EDGE_STATES, SCREEN_ROUTES } from './edge-states/inventory';
export type {
  EdgeState,
  EdgeStateCoverage,
  EdgeStateInventory,
  ScreenId,
} from './edge-states/inventory';
export { ToastHost, toast } from './components/toast';
export type { ToastTone } from './components/toast';

// Persistent undo tray (D35, D58). Data is injected via the
// `dataSource` prop — the host app owns transport (CSRF, base URL).
export { UndoTray } from './components/undo-tray';
export type { UndoActionKind, UndoTrayDataSource, UndoTrayEntry } from './components/undo-tray';

// D166 — skeleton-first loading primitives + composite skeletons
// matching the launch screens (Triage queue, Senders list, Sender
// Detail) plus an `<InlineProgress>` for button-level action progress.
export {
  Skeleton,
  SkeletonLines,
  TriageQueueSkeleton,
  TriageRowCardSkeleton,
  SenderRowSkeleton,
  SendersListSkeleton,
  SenderDetailSkeleton,
  SenderDetailHeaderSkeleton,
  SenderDetailStatsSkeleton,
  SenderDetailChartsSkeleton,
  SenderDetailMessagesSkeleton,
} from './components/skeleton';
export type {
  SkeletonProps,
  SkeletonVariant,
  SkeletonLinesProps,
  TriageQueueSkeletonProps,
  SendersListSkeletonProps,
} from './components/skeleton';
export { InlineProgress } from './components/inline-progress';
export type { InlineProgressProps } from './components/inline-progress';

export { Sidebar } from './shell/sidebar';
export { AppShell } from './shell/app-shell';

// D200 — Zustand client-state scaffold. Server state lives in
// TanStack Query; client-only ephemeral flags shared across features
// live here.
export { useUiStore } from './state/ui-store';
export type { UiState, UiActions } from './state/ui-store';

// D19 — tier manifest + entitlement model. Pure TS (also importable via
// the `@declutrmail/shared/entitlements` subpath without the component
// tree). Composes with the Action Registry — see entitlements/types.ts.
export { TIER_MANIFEST } from './entitlements/index';
export {
  cleanupActionsLifetimeFor,
  hasCapability,
  inboxLimitFor,
  satisfiesActionTier,
  tierById,
  undoWindowDaysFor,
} from './entitlements/index';
export { CAPABILITIES, PROMO_IDS, TIER_IDS, TIER_RANK } from './entitlements/index';
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
} from './entitlements/index';

// ADR-0025 — feature-flag manifest + resolution. Pure TS (also
// importable via the `@declutrmail/shared/flags` subpath by consumers
// that must avoid the React component tree, e.g. API/worker modules).
export {
  FLAG_MANIFEST,
  FEATURE_FLAGS,
  flagEnvKey,
  resolveFlag,
  resolveAllFlags,
} from './flags/index';
export type { FeatureFlag, FlagDefinition } from './flags/index';

// D7 + D228 — privacy copy module. Re-exported so consumers can pull
// canonical wording without depending on the components subtree.
export {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_BADGE_LEAD,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
  GMAIL_PREVIEW_FIELD_LABEL,
} from './copy/privacy';
