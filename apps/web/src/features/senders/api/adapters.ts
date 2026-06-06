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
/**
 * Adapt a Weekly Hero slice row (D47/D48 — `GET /api/senders/weekly-hero`)
 * into the FE `Sender` shape so the Hero CTA's review-session opens
 * across the FULL slice even when slice members live outside the
 * currently-loaded paginated sender list (PR #115 P2 review).
 *
 * The hero DTO carries `id, displayName, email, domain, monthlyVolume,
 * readRate, sparkline` — everything the K/A/U/L action surface actually
 * reads. The wider `Sender` shape carries fields the hero doesn't
 * surface (group, lastDays, firstSeenMo, volumeTrend, lastReview). Those
 * default to safe placeholders here:
 *   - `group: 'updates'` — Gmail's "things that aren't conversations"
 *     bucket. Hero slices are inherently update-flavoured (cleanup
 *     candidates), so this is the closest safe default. The review
 *     session uses `group` only for filter-pill rendering; cleared via
 *     refresh once the user navigates to the full senders list.
 *   - `lastDays: 0`, `firstSeenMo: 12` — the hero already implicitly
 *     filtered for relationship age (quiet slice = first_seen ≥ 6mo,
 *     other slices have a current-month timeseries row), so a non-zero
 *     `firstSeenMo` keeps the cadence-line render sane.
 *   - `volumeTrend: null`, `lastReview: null` — the row tile falls
 *     back to its evidence-line render for these.
 *
 * `spark` is the BE-provided 12-month sparkline (chronological,
 * 0-padded) — already correct, no shaping needed.
 */
export function adaptHeroSender(row: {
  id: string;
  displayName: string;
  email: string;
  domain: string;
  monthlyVolume: number;
  readRate: number | null;
  sparkline: number[];
}): Sender {
  return {
    id: row.id,
    name: row.displayName || row.email,
    domain: row.domain,
    monthly: row.monthlyVolume,
    group: 'updates',
    read: row.readRate ?? 0,
    spark: row.sparkline,
    lastDays: 0,
    unread: 0,
    firstSeenMo: 12,
    volumeTrend: null,
    lastReview: null,
  };
}

export function adaptSenderListRow(row: SenderListRow, now: number = Date.now()): Sender {
  // BE returns `monthlyVolume` and `readRate` as nullable when the
  // sender has no `sender_timeseries` rows yet. The FE `Sender` shape
  // pre-dates that nullability (carries `number`); coerce to `0` so
  // existing sort / why-line code paths keep working and the
  // missing-data case degrades to a quiet "0/mo" rather than a NaN
  // render. The `volumeTrend` chip + `lastReview` slot are the
  // canonical surfaces for "no data yet" — they explicitly carry
  // `null` instead of pretending.
  const monthly = row.monthlyVolume ?? 0;
  const read = row.readRate ?? 0;
  const sender: Sender = {
    id: row.id,
    name: row.displayName || row.email,
    domain: row.domain,
    monthly,
    // Real all-time received count (`senders.total_received`) — carried
    // through verbatim. Replaces the former `monthly × 12` fabrication.
    total: row.totalReceived,
    group: CATEGORY_TO_GROUP[row.gmailCategory],
    read,
    // Real 12-week sparkline from BE (oldest → newest). Falls back to a
    // flat 4-bucket line at the recent cadence when the BE omits it (very
    // old senders with no recent mail_messages rows).
    spark:
      row.sparkline && row.sparkline.length > 0
        ? row.sparkline
        : [monthly, monthly, monthly, monthly].map((v) => Math.round(v / 4)),
    lastDays: daysSince(row.lastSeenAt, now),
    // Wire doesn't return current-unread-from-sender yet. Surfaces as 0
    // in the row badge until BE adds the field — non-blocking.
    unread: 0,
    firstSeenMo: monthsSince(row.firstSeenAt, now),
    volumeTrend: row.volumeTrend,
    lastReview: row.lastReview,
    // Standing policy flags now ride the list row (BE
    // `SenderListRow.protectionFlags`). `protected` drives the row's
    // "Protected" chip + the "Protected" KPI; `isVip` is OR-ed into the
    // "Protect" intent bucket (intentOf) so VIPs never land in Cleanup.
    // Optional-chained so a malformed / older response that omits the
    // block degrades to "not protected" rather than crashing the list.
    protected: row.protectionFlags?.isProtected ?? false,
    isVip: row.protectionFlags?.isVip ?? false,
    // Standing-policy unsub state (D38 + 2026-06-05 brainstorm). True
    // when the BE has the sender's policy at `'unsubscribe'`. Drives
    // the "Unsub queued" pill on the sender card.
    unsubPending: row.policyType === 'unsubscribe',
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
  const isVip = args.detail.protectionFlags.isVip;
  const isProtected = args.detail.protectionFlags.isProtected;
  // The wire's `protection_reason` enum (BE source-of-truth) maps to the
  // narrower FE `ProtectionReason` union used by the header chip + banner:
  //   user_defined     → user-marked
  //   engagement_based → auto-receipts (closest existing FE bucket today;
  //                       a richer enum lands when the BE adds more reasons)
  //   vip              → user-marked (header already renders the VIP chip
  //                       separately from the Protect chip)
  // If `isProtected` is true but the wire omits the reason, fall back to
  // `user-marked` so the chip renders something rather than nothing.
  const wireReason = args.detail.protectionFlags.protectionReason;
  const protectionReason: ProtectionReason | null = isProtected
    ? wireReason === 'engagement_based'
      ? 'auto-receipts'
      : 'user-marked'
    : null;

  // Use the existing fixture-builder for the synthesised fields
  // (recommendation only — stats are now wire-driven), then overlay
  // wire-derived lists. When the BE PR adds richer recommendation rows
  // we delete the fallback and pass the wire values through directly.
  const seeded = buildSenderDetail(sender, { isVip, isProtected });

  const stats: SenderStats = {
    // Both BE fields are nullable when sender has no timeseries; coerce
    // to 0 because the existing chart + stats components carry
    // `number` types. The empty-state cue is `volumeTrend === null`.
    monthlyVolume: args.detail.monthlyVolume ?? 0,
    readRate: args.detail.readRate ?? 0,
    relationshipMonths: monthsSince(args.detail.firstSeenAt, args.now),
    lastSeenDays: daysSince(args.detail.lastSeenAt, args.now),
    volumeTrend: args.detail.volumeTrend,
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
  llm_haiku: 'Triage',
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
