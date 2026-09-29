// apps/web/src/features/senders/uplift-d/index.ts
//
// Barrel for Variant D Senders uplift primitives — feature-owned per
// ADR-0007 (lazy promotion). When the second consumer (Activity, Brief,
// Insights) needs any of these, that PR moves the primitive to
// packages/shared/src/components/ and re-points both consumers' imports
// in the same commit.
//
// InboxStoryHero + WeeklyProgress deleted in the 2026-07-04 dead-code
// sweep (retired by spec v1.2 Decision 4, zero consumers). KpiStrip
// deleted 2026-09-21 — Sender Detail's bordered KPI cards became a quiet
// stats row, leaving it with zero consumers too.

export { DecisionTimeline } from './decision-timeline';
export type { DecisionTimelineProps, TimelineItem } from './decision-timeline';
