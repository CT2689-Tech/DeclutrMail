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
import { findDomainBatches, type DomainBatch } from '@/features/triage/domain-batch';
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

/**
 * The amazon.com domain batch, independently — `buildSyntheticRulePreview`
 * has no parameters (matches `ActivateRuleModal`'s dry-run shape: the real
 * `POST /rules/:id/preview` also takes none, since a rule's matcher runs
 * against the whole mailbox). Recomputed from the same `TRIAGE_QUEUE` the
 * screen's own `amazonBatch` derives from, so the two can never disagree.
 */
function requireAmazonBatch(): DomainBatch {
  const batch = findDomainBatches(TRIAGE_QUEUE).find(
    (candidate) => candidate.domain === 'amazon.com',
  );
  if (!batch) throw new Error('Missing inbox simulator fixture batch: amazon.com');
  return batch;
}

/**
 * The Autopilot rule step 3 offers — a brand-new, never-enabled preset
 * that would cover the same senders step 1 just archived by hand.
 * `enabled: false` and no run history: nothing has acted on the
 * visitor's behalf yet. `presetKey`/`actionKind`/`confidenceThreshold`/
 * the real `auto_archive_low_engagement` preset
 * (`packages/workers/src/autopilot-presets.ts`) so the numbers this
 * demo cites trace to the product's own configuration, not an invented
 * one.
 */
export const SYNTHETIC_RULE: AutopilotRuleDto = {
  id: 'demo-rule-archive-amazon',
  presetKey: 'auto_archive_low_engagement',
  isPreset: true,
  name: 'Auto-archive low-engagement',
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
 * Dry-run preview for `SYNTHETIC_RULE` — the local stand-in for
 * `POST /rules/:id/preview`. Matched senders are the SAME five eligible
 * amazon.com senders step 1 just archived (`buildSyntheticBulkPreview`'s
 * own eligible set), so this step reads as that decision's consequence
 * rather than a new topic. The sixth, Protected sender is counted as
 * `protectedWouldMatchCount`, never folded into what would act (D245 —
 * Protected never matched).
 */
export function buildSyntheticRulePreview(): RulePreviewState {
  const batch = requireAmazonBatch();
  const matched = batch.eligibleRows;
  const protectedCount = batch.rows.length - matched.length;

  const sample: AutopilotPreviewSampleDto[] = matched.map((row) => ({
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
      // Archive has no channel dependency (unlike Unsubscribe), so every
      // matched sender is actionable now.
      actionableSenderCount: matched.length,
      actionableMessageCount: matched.reduce((sum, row) => sum + syntheticInboxCount(row), 0),
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
