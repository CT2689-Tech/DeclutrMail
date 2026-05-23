/**
 * BE → FE adapters for the Senders surface.
 *
 * The wire types (`apps/web/src/lib/api/senders.ts`) match the frozen
 * BE contract. The component types (`features/senders/data.ts`,
 * `features/senders/detail/types.ts`) predate the wire contract and
 * carry slightly richer shapes for the UI (synthesised stats, sparkline,
 * past-tense decision labels, etc.).
 *
 * Two principled reasons we adapt at the seam rather than rewrite the
 * components:
 *
 *   1. Surgical change (CLAUDE.md §1.3). The components already render
 *      correctly against their shapes — touching them risks the visual
 *      regressions the design-freeze hooks were put in place to prevent
 *      (D210). The wire is the new thing; map to what works.
 *   2. Fields not on the wire (e.g. `Sender.spark`, the 4-week
 *      sparkline, or `RecentMessage.sizeBytes`) are inferred locally so
 *      the visual contract holds until later BE iterations send them.
 *      Each inferred field is commented inline so the mapping is
 *      explicit rather than magical.
 */

import type {
  DecisionHistoryRowDto,
  GmailCategory,
  MailMessageRow,
  SenderDetailDto,
  SenderListRow,
  TimeseriesPointDto,
} from '@/lib/api/senders';
import type { Sender, SenderGroup } from '../data';
import type {
  DecisionAction,
  DecisionHistoryRow,
  DecisionSource,
  ProtectionReason,
  RecentMessage,
  SenderDetail,
  SenderStats,
  TimeseriesPoint,
  Verdict,
} from '../detail/types';
import { buildSenderDetail } from '../detail/data';

/** Maps Gmail category → component-side `SenderGroup` (they're synonyms today). */
const CATEGORY_TO_GROUP: Record<GmailCategory, SenderGroup> = {
  primary: 'primary',
  promotions: 'promotions',
  social: 'social',
  updates: 'updates',
  forums: 'forums',
};

/** Computes days between an ISO date and "now" — clamped to 0. */
function daysSince(iso: string, now: number = Date.now()): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

/** Computes whole months between an ISO date and "now" — clamped to 0. */
function monthsSince(iso: string, now: number = Date.now()): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24 * 30)));
}

/**
 * Adapt a wire `SenderListRow` to the FE `Sender` shape. Fields not on
 * the wire (sparkline, unread count, spike flag) are zero/defaulted —
 * the BE PR will add them in a follow-up; for now the visuals degrade
 * gracefully (flat sparkline, zero unread badge, no spike chip).
 */
export function adaptSenderListRow(row: SenderListRow, now: number = Date.now()): Sender {
  const sender: Sender = {
    id: row.id,
    name: row.displayName || row.email,
    domain: row.domain,
    monthly: row.monthlyVolume,
    group: CATEGORY_TO_GROUP[row.gmailCategory],
    read: row.readRate,
    // 4-week sparkline placeholder — wire doesn't carry per-week buckets
    // yet; render a flat line at the recent monthly cadence quarter.
    spark: [row.monthlyVolume, row.monthlyVolume, row.monthlyVolume, row.monthlyVolume].map((v) =>
      Math.round(v / 4),
    ),
    lastDays: daysSince(row.lastSeenAt, now),
    // Wire doesn't return current-unread-from-sender yet. Surfaces as 0
    // in the row badge until BE adds the field — non-blocking.
    unread: 0,
    firstSeenMo: monthsSince(row.firstSeenAt, now),
  };
  return sender;
}

/**
 * Adapt the wire `SenderDetailDto` + paginated child responses into the
 * FE `SenderDetail` model the page already consumes.
 *
 * `buildSenderDetail` (the existing fixture helper) already synthesises
 * the recommendation / stats / timeseries / history from a `Sender`.
 * For now we layer the wire data ON TOP of that synthesis — wire-driven
 * recent messages, timeseries, and history override the synthesised
 * ones; recommendation + stats fall back to the synthesised values
 * (the BE doesn't return a recommendation row yet — that lands in a
 * later iteration of the Sender Detail API).
 */
export function adaptSenderDetail(args: {
  detail: SenderDetailDto;
  messages: MailMessageRow[];
  timeseries: TimeseriesPointDto[];
  history: DecisionHistoryRowDto[];
  now?: number;
}): SenderDetail {
  const sender = adaptSenderListRow(args.detail, args.now);
  const isVip = args.detail.protectionFlags.vip;
  const isProtected = args.detail.protectionFlags.protect;
  const protectionReason: ProtectionReason | null = isProtected ? 'user-marked' : null;

  // Use the existing fixture-builder for the synthesised fields
  // (recommendation, stats), then overlay wire-derived lists. When the
  // BE PR adds richer recommendation rows + stats blocks we delete the
  // fallback and pass the wire values through directly.
  const seeded = buildSenderDetail(sender, { isVip, isProtected });

  const stats: SenderStats = {
    monthlyVolume: args.detail.monthlyVolume,
    readRate: args.detail.readRate,
    relationshipMonths: monthsSince(args.detail.firstSeenAt, args.now),
    lastSeenDays: daysSince(args.detail.lastSeenAt, args.now),
    // The wire doesn't return a lifetime sum yet — `seeded` synthesises
    // it from monthly × relationship-months, which is a reasonable
    // placeholder until BE adds the field.
    totalAllTime: seeded.stats.totalAllTime,
  };

  return {
    sender,
    gmailCategory: seeded.gmailCategory,
    isVip,
    isProtected,
    protectionReason,
    recommendation: seeded.recommendation,
    recentMessages: args.messages.map(adaptMailMessageRow),
    stats,
    timeseries: args.timeseries.map(adaptTimeseriesPoint),
    history: args.history.map(adaptDecisionHistoryRow),
  };
}

/** Wire message row → FE recent-message row. `sizeBytes` placeholdered (wire omits). */
export function adaptMailMessageRow(row: MailMessageRow): RecentMessage {
  return {
    id: row.id,
    providerMessageId: row.providerMessageId,
    threadId: row.providerThreadId,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.internalDate,
    // Wire omits message size — render as 0B until BE adds the field.
    // The UI gracefully shows "0B" rather than crashing, and the row
    // height is unaffected.
    sizeBytes: 0,
    // Wire omits attachment indicator — default false. BE follow-up.
    hasAttachment: false,
    unread: row.isUnread,
  };
}

/**
 * Wire timeseries point → FE timeseries point. The wire's
 * `readCount` maps onto the FE's `opens` (same meaning — the count of
 * messages that were read in the month).
 *
 * The wire uses `YYYY-MM-DD` (first of month); the FE chart accepts
 * the same string and only uses it as an axis key, so we forward it
 * verbatim. The chart never parses the date — keys just need to be
 * stable and ordered.
 */
export function adaptTimeseriesPoint(p: TimeseriesPointDto): TimeseriesPoint {
  return {
    yearMonth: p.yearMonth,
    volume: p.volume,
    opens: p.readCount,
  };
}

const VERDICT_TO_ACTION: Record<DecisionHistoryRowDto['verdict'], DecisionAction> = {
  keep: 'Kept',
  archive: 'Archived',
  unsubscribe: 'Unsubscribed',
  later: 'Moved to Later',
};

const GENERATED_BY_TO_SOURCE: Record<DecisionHistoryRowDto['generatedBy'], DecisionSource> = {
  llm: 'Triage',
  template: 'System',
};

/**
 * Wire history row → FE history row. The wire schema is narrower (just
 * the engine's recorded decisions) than the FE component supports (the
 * component renders any `activity_log` row, including VIP toggles and
 * Restore actions). The component handles a degenerate `count` of 0 by
 * omitting the email-count span, so we leave it unset.
 */
export function adaptDecisionHistoryRow(row: DecisionHistoryRowDto): DecisionHistoryRow {
  return {
    id: row.id,
    at: row.producedAt,
    source: GENERATED_BY_TO_SOURCE[row.generatedBy],
    action: VERDICT_TO_ACTION[row.verdict],
    opId: row.id,
  };
}

/** Verdict mapping is not used by the page directly — re-exported for tests. */
export const _internalVerdictMap: Record<DecisionHistoryRowDto['verdict'], Verdict> = {
  keep: 'keep',
  archive: 'archive',
  unsubscribe: 'unsubscribe',
  later: 'later',
};
