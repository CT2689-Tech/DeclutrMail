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
import type { AutopilotPreviewSampleDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import type { RulePreviewState } from '@/features/autopilot/types';
import type { DomainBatch } from '@/features/triage/domain-batch';
import { TRIAGE_QUEUE, type TriageDecisionRow } from '@/features/triage/data';
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

/** Explicit sample of mail outside Inbox. It is bounded by the fixture's
 * received total and exists only to exercise the real Delete reach choice. */
export function syntheticArchivedCount(row: TriageDecisionRow): number {
  return Math.max(
    0,
    Math.min(row.totalAllTime - syntheticInboxCount(row), Math.round(row.totalAllTime * 0.3)),
  );
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
 * `DomainBatch`'s eligible rows — the local stand-in for
 * `POST /api/actions/preview/bulk`. The product sends only eligible
 * sender IDs to that endpoint. Protected, Keep, and low-signal Later
 * rows remain visible in the card for individual review, but never
 * enter the preview's count or confirm payload.
 */
export function buildSyntheticBulkPreview(batch: DomainBatch): BulkActionPreviewResult {
  const senders = batch.eligibleRows.map((row) => ({
    senderId: row.senderId,
    name: row.senderName,
    counts: { ...EMPTY_BUCKETS, all: syntheticInboxCount(row) },
    protected: false,
  }));
  const totalAll = senders.reduce((sum, sender) => sum + sender.counts.all, 0);
  return {
    senders,
    totals: { ...EMPTY_BUCKETS, all: totalAll },
    protectedCount: 0,
  };
}

/**
 * An existing product preset, independent of the manual batch in step 1.
 * The real product does not create custom rules from a sender decision.
 */
export const SYNTHETIC_RULE: AutopilotRuleDto = {
  id: 'demo-rule-archive-low-engagement',
  presetKey: 'auto_archive_low_engagement',
  isPreset: true,
  name: 'Review low-engagement senders for Archive',
  enabled: false,
  mode: 'observe',
  modeChangedAt: '2026-08-01T00:00:00.000Z',
  observeWindowEndsAt: null,
  observeWindowElapsed: false,
  observePromptDismissedAt: null,
  observeDigest: null,
  confidenceThreshold: 0.72,
  scope: 'account',
  actionKind: 'archive',
  actionPayload: {},
  lastRunAt: null,
  lastRunActions: 0,
  lastRunSenders: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/**
 * Dry run of the same predicate as `auto_archive_low_engagement` in
 * `packages/workers/src/autopilot-presets.ts`: engine Archive verdict
 * with confidence strictly above 0.72. Protected matches are excluded.
 * Manual decisions do not change the rule's match predicate, but mail
 * already moved out of Inbox cannot count as actionable again.
 */
export function buildSyntheticRulePreview(
  decisions: readonly { rowId: string; affectedCount: number }[] = [],
): RulePreviewState {
  const threshold = SYNTHETIC_RULE.confidenceThreshold;
  if (threshold === null)
    throw new Error('The demo Archive preset requires a confidence threshold');
  const wouldMatch = TRIAGE_QUEUE.filter(
    (row) => row.verdict === 'archive' && row.confidence > threshold,
  );
  const matched = wouldMatch.filter((row) => row.protectionReason === null);
  const protectedCount = wouldMatch.length - matched.length;
  const movedBySender = new Map(
    decisions.map((decision) => [decision.rowId, decision.affectedCount]),
  );
  const remainingInboxCount = (row: TriageDecisionRow) =>
    Math.max(0, syntheticInboxCount(row) - (movedBySender.get(row.id) ?? 0));
  const actionable = matched.filter((row) => remainingInboxCount(row) > 0);

  const sample: AutopilotPreviewSampleDto[] = actionable.map((row) => ({
    senderKey: row.senderKey,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    reason: row.reasoning,
  }));

  return {
    status: 'ready',
    result: {
      ruleId: SYNTHETIC_RULE.id,
      wouldMatchCount: matched.length,
      actionableSenderCount: actionable.length,
      actionableMessageCount: actionable.reduce((sum, row) => sum + remainingInboxCount(row), 0),
      protectedWouldMatchCount: protectedCount,
      evaluatedSenders: TRIAGE_QUEUE.length,
      // Mirrors `auto_archive_low_engagement`'s real daily cap
      // (`packages/workers/src/autopilot-presets.ts`) — not a
      // client-side dependency, since that package is Node-only.
      dailyActionCap: 100,
      // A never-enabled rule has no Observe history to report a real
      // 7-day window from; `matched.length` over the one day this
      // snapshot represents is the honest floor for the extrapolation.
      weeklyVolume: {
        observedMatches: matched.length,
        observedDays: 1,
        estimatedMatches: matched.length * 7,
        basis: 'early_estimate',
      },
      sample,
    },
  };
}
