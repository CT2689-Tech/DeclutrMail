// apps/web/src/features/senders/uplift-d/index.ts
//
// Barrel for Variant D Senders uplift primitives — feature-owned per
// ADR-0007 (lazy promotion). When the second consumer (Activity, Brief,
// Insights) needs any of these, that PR moves the primitive to
// packages/shared/src/components/ and re-points both consumers' imports
// in the same commit.
//
// Wired in by:
//   - feat/d038-senders-list-uplift-d  (consumes InboxStoryHero,
//     KpiStrip, intentOf/groupByIntent) — pending PR
//   - feat/d039-senders-detail-uplift-d  (consumes KpiStrip,
//     DecisionTimeline) — pending PR

export { intentOf, groupByIntent, INTENT_ORDER, INTENT_META } from './intent';
export type { SenderIntent, IntentMeta, IntentBucket } from './intent';

export { KpiStrip } from './kpi-strip';
export type { KpiStripProps, KpiCellProps } from './kpi-strip';

export { InboxStoryHero } from './inbox-story-hero';
export type { InboxStoryHeroProps } from './inbox-story-hero';

export { DecisionTimeline } from './decision-timeline';
export type { DecisionTimelineProps, TimelineItem } from './decision-timeline';

export { WeeklyProgress } from './weekly-progress';
export type { WeeklyProgressProps } from './weekly-progress';
