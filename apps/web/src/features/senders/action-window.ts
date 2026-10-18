import type { CompositeActionPreviewResult } from '@/lib/api/use-action';

/** One date vocabulary for action previews and Unsubscribe's cleanup add-on. */
export const TIME_WINDOW_PRESETS = [
  { label: 'All inbox', days: null as number | null },
  { label: '30 days+', days: 30 },
  { label: '3 months+', days: 90 },
  { label: '6 months+', days: 180 },
  { label: '1 year+', days: 365 },
] as const;

/** Older snapshots can supply only `all`; missing age buckets stay unknown. */
export type ActionWindowCounts = Partial<CompositeActionPreviewResult['counts']>;

export function pickBucketCount(
  counts: ActionWindowCounts | undefined,
  olderThanDays: number | null,
): number | undefined {
  if (!counts) return undefined;
  if (olderThanDays === null) return counts.all;
  if (olderThanDays === 30) return counts.olderThan30d;
  if (olderThanDays === 90) return counts.olderThan90d;
  if (olderThanDays === 180) return counts.olderThan180d;
  if (olderThanDays === 365) return counts.olderThan365d;
  return undefined;
}

/** Every included sender must have the bucket before a cleanup can be armed. */
export function sumBucketCounts(
  counts: Array<ActionWindowCounts | undefined>,
  olderThanDays: number | null,
): number | undefined {
  let total = 0;
  for (const row of counts) {
    const count = pickBucketCount(row, olderThanDays);
    if (count === undefined) return undefined;
    total += count;
  }
  return total;
}
