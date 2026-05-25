// @declutrmail/shared — design tokens, primitives, app shell, and
// external-integration contracts (D201).

export type { KmsProvider } from './contracts/index';
export type { DecodedCursor, Envelope, PaginatedEnvelope, PaginationMeta } from './contracts/index';
export { clampLimit, decodeCursor, encodeCursor, ok, paginated, withMeta } from './contracts/index';

export { tokens } from './tokens/tokens';
export type { Tokens } from './tokens/tokens';

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

// D211 — typed edge-state inventory. Enforces that every launch screen
// has designed coverage for every edge state it can enter.
export { EDGE_STATE_INVENTORY, EDGE_STATES } from './edge-states/inventory';
export type {
  EdgeState,
  EdgeStateCoverage,
  EdgeStateInventory,
  ScreenId,
} from './edge-states/inventory';
export { ToastHost, toast } from './components/toast';
export type { ToastTone } from './components/toast';

// Persistent undo tray (D35, D58) + its data-source hook.
export { UndoTray, useUndoTray } from './components/undo-tray';
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
