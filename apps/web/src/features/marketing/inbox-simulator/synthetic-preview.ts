/**
 * Synthetic preview builders for the public inbox simulator (D133 Plan 4).
 *
 * The demo has no network and no signed-in mailbox. `BatchActionSheet`
 * normally reads its aggregated counts from `POST /api/actions/preview/bulk`
 * (D226) — the simulator must never import that client, since doing so
 * would put the authenticated API surface back in a public route's chunk
 * (the exact regression Plan 3 cut; see the chunk-baseline doc). These
 * helpers build the SAME shapes the product's own components expect,
 * entirely from the local fixture rows.
 */
import type { DomainBatch } from '@/features/triage/domain-batch';
import type { TriageDecisionRow } from '@/features/triage/data';
import type { BulkActionPreviewResult } from '@/lib/api/use-action';

/**
 * A believable "live inbox count" for one fixture row — the number the
 * demo shows as what an action would move right now. Prefers the 90-day
 * count (the same window the row's own signals cite); falls back to a
 * small slice of all-time volume for a sender quiet in that window, so a
 * long-lived but currently-silent sender never presents as "0 in Inbox".
 */
export function syntheticInboxCount(row: TriageDecisionRow): number {
  if (row.last90dMessages === 0) return Math.min(row.totalAllTime, 6);
  return Math.max(1, Math.min(row.last90dMessages, row.totalAllTime));
}

/** No time-bucketed fixture data exists, so only `all` is ever non-zero —
 *  matching the convention `batch-action-sheet.stories.tsx` already uses
 *  for the same reason. */
const EMPTY_BUCKETS = {
  all: 0,
  olderThan30d: 0,
  olderThan90d: 0,
  olderThan180d: 0,
  olderThan365d: 0,
} as const;

/**
 * Build a `BulkActionPreviewResult` for `BatchActionSheet` from a
 * `DomainBatch`'s own rows — the local stand-in for
 * `POST /api/actions/preview/bulk`. Protected rows are marked
 * `protected: true` and excluded from `totals`, mirroring the real
 * preview: the total is what will actually move, never what the run
 * merely contains (D245 — Protected never bulks).
 */
export function buildSyntheticBulkPreview(batch: DomainBatch): BulkActionPreviewResult {
  const senders = batch.rows.map((row) => ({
    senderId: row.senderId,
    name: row.senderName,
    counts: { ...EMPTY_BUCKETS, all: syntheticInboxCount(row) },
    protected: row.protectionReason !== null,
  }));
  const totalAll = senders
    .filter((sender) => !sender.protected)
    .reduce((sum, sender) => sum + sender.counts.all, 0);
  return {
    senders,
    totals: { ...EMPTY_BUCKETS, all: totalAll },
    protectedCount: senders.filter((sender) => sender.protected).length,
  };
}
