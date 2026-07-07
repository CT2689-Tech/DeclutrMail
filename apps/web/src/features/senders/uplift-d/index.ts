// apps/web/src/features/senders/uplift-d/index.ts
//
// Barrel for Variant D Senders uplift primitives — feature-owned per
// ADR-0007 (lazy promotion). When the second consumer (Activity, Brief,
// Insights) needs any of these, that PR moves the primitive to
// packages/shared/src/components/ and re-points both consumers' imports
// in the same commit.
//
// InboxStoryHero + WeeklyProgress deleted in the 2026-07-04 dead-code
// sweep (retired by spec v1.2 Decision 4, zero consumers).

export { intentOf, groupByIntent, INTENT_ORDER, INTENT_META } from './intent';
export type { SenderIntent, IntentMeta, IntentBucket } from './intent';

export { KpiStrip } from './kpi-strip';
export type { KpiStripProps, KpiCellProps } from './kpi-strip';

export { DecisionTimeline } from './decision-timeline';
export type { DecisionTimelineProps, TimelineItem } from './decision-timeline';
