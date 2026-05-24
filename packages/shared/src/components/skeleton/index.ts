// D166 — skeleton-first loading primitives + composite skeletons that
// match the launch screens (Triage queue, Senders list, Sender Detail).
// The page-level skeletons own `role=status`; the primitive is
// `aria-hidden` so consumers can compose without double-announcement.

export { Skeleton, SkeletonLines } from './skeleton';
export type { SkeletonProps, SkeletonVariant, SkeletonLinesProps } from './skeleton';

export { TriageQueueSkeleton, TriageRowCardSkeleton } from './triage-queue-skeleton';
export type { TriageQueueSkeletonProps } from './triage-queue-skeleton';

export { SenderRowSkeleton, SendersListSkeleton } from './sender-row-skeleton';
export type { SendersListSkeletonProps } from './sender-row-skeleton';

export {
  SenderDetailSkeleton,
  SenderDetailHeaderSkeleton,
  SenderDetailStatsSkeleton,
  SenderDetailChartsSkeleton,
  SenderDetailMessagesSkeleton,
} from './sender-detail-skeleton';
