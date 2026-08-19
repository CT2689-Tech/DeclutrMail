/**
 * BE → FE adapters for the Senders surface.
 *
 * The list-row adaptation is GONE (2026-07-16 wire unification): the
 * `Sender` model IS the wire row plus derived fields, built by
 * `enrichSenderRow` in `../data`. The hand-mapped adapter this file
 * used to carry dropped `repliedCount` and coerced `readRate: null`
 * into a fake "never read" — a class of bug the spread-based enrich
 * makes structurally impossible.
 *
 * What remains here is the Sender Detail composition: the detail DTO +
 * its paginated child responses (messages, timeseries, history) fold
 * into the one `SenderDetail` value the page consumes. Every field
 * comes from the wire or an explicit presentation derivation of a wire
 * field; nullable wire facts stay nullable (a `null` readRate renders
 * as "—", never "0%").
 */

import type {
  DecisionHistoryRowDto,
  GmailCategory,
  MailMessageRow,
  ProtectionReasonWire,
  SenderDetailDto,
  TimeseriesPointDto,
} from '@/lib/api/senders';
import { daysSince, enrichSenderRow, monthsSince } from '../data';
import type {
  DecisionAction,
  DecisionHistoryRow,
  DecisionSource,
  ProtectionReason,
  RecentMessage,
  SenderDetail,
  SenderStats,
  TimeseriesPoint,
} from '../detail/types';

/** Display labels derived directly from the Gmail category on the wire. */
const CATEGORY_TO_LABEL: Record<GmailCategory, string> = {
  primary: 'Gmail: Primary',
  promotions: 'Gmail: Promotions',
  social: 'Gmail: Social',
  updates: 'Gmail: Updates',
  forums: 'Gmail: Forums',
};

/**
 * Map the wire `protection_reason` enum (BE source-of-truth) onto the
 * narrower FE `ProtectionReason` union used by the header chip + banner:
 *   user_defined    → user-marked
 *   replied         → replied
 *   starred         → starred
 *   gmail_important → gmail-important
 *
 * A protected sender whose wire reason is null or unrecognized maps to
 * `null`, NOT to `user-marked`. The old fallback invented a statement
 * about the user's own actions ("you marked it Protected") for any
 * enum value this build didn't know — the exact failure
 * `@declutrmail/shared/copy/protection` exists to end, still alive one
 * adapter upstream of it. Consumers already render the honest minimum
 * for `isProtected && reason === null` ("Protected", no evidence
 * clause).
 *
 * Shared by `adaptSenderDetail` (query path) and the Sender Detail
 * Protect toggle `onSuccess` reconcile (mutation path) so both
 * derive the header chip from the same mapping.
 */
export function adaptProtectionReason(
  isProtected: boolean,
  wireReason: ProtectionReasonWire | null,
): ProtectionReason | null {
  if (!isProtected) return null;
  if (wireReason === 'user_defined') return 'user-marked';
  if (wireReason === 'replied' || wireReason === 'starred') return wireReason;
  if (wireReason === 'gmail_important') return 'gmail-important';
  return null;
}

export function adaptSenderDetail(args: {
  detail: SenderDetailDto;
  messages: MailMessageRow[];
  timeseries: TimeseriesPointDto[];
  history: DecisionHistoryRowDto[];
  now?: number;
}): SenderDetail {
  const sender = enrichSenderRow(args.detail, args.now);
  const isProtected = args.detail.protectionFlags.isProtected;
  const protectionReason: ProtectionReason | null = adaptProtectionReason(
    isProtected,
    args.detail.protectionFlags.protectionReason,
  );

  const now = args.now ?? Date.now();
  const stats: SenderStats = {
    // `monthlyVolume` is nullable when the sender has no
    // `sender_timeseries` rows yet; the chart + KPI cells key their
    // empty state off the timeseries itself, so 0 is safe for the
    // cadence figure. `readRate` stays null — "we don't know" must
    // never render as "0% read".
    monthlyVolume: args.detail.monthlyVolume ?? 0,
    readRate: args.detail.readRate,
    relationshipMonths: monthsSince(args.detail.firstSeenAt, now),
    lastSeenDays: daysSince(args.detail.lastSeenAt, now),
    volumeTrend: args.detail.volumeTrend,
  };

  return {
    sender,
    // Wire email address — drives the "Open all in Gmail" deep link.
    // Sender.name may be the display name ("Robinhood") so we keep the
    // raw email separate (FOUNDER-FOLLOWUPS 2026-06-06 Q3.2).
    email: args.detail.email,
    // Presentation-only formatting of the real Gmail category enum.
    gmailCategory: CATEGORY_TO_LABEL[args.detail.gmailCategory],
    isProtected,
    protectionReason,
    // Standing-policy pill on Sender Detail (FOUNDER-FOLLOWUPS
    // 2026-06-05). The wire row carries `policyType`; the page header
    // reads it directly. Default `null` keeps existing tests that don't
    // set the field from breaking.
    policyType: args.detail.policyType ?? null,
    // D9 Wave 2 — unsub execution outcome + the D230 manual-path
    // mailto URL (detail-only wire field). Both default null for
    // fixtures that predate the pipeline.
    unsubStatus: args.detail.unsubStatus ?? null,
    unsubscribeMethod: args.detail.unsubscribeMethod ?? null,
    unsubscribeMailtoUrl: args.detail.unsubscribeMailtoUrl ?? null,
    // The detail wire contract has no recommendation field. Do not
    // manufacture one from fixture heuristics for connected accounts.
    recommendation: null,
    recentMessages: args.messages.map(adaptMailMessageRow),
    stats,
    timeseries: args.timeseries.map(adaptTimeseriesPoint),
    history: args.history.map(adaptDecisionHistoryRow),
  };
}

/**
 * Wire message row → FE recent-message row.
 *
 * `sizeBytes` is forwarded verbatim (nullable per ADR-0021). The render
 * layer shows an em-dash on null OR zero; this adapter does NOT coerce.
 *
 * D7: `hasAttachment` stays a placeholder. The indicator would require
 * either reading attachment metadata (banned by D7) OR inferring from
 * `sizeEstimate` / MIME-boundary heuristics — which effectively
 * reconstitutes attachment metadata from the allowlisted integer. Do
 * NOT add such inference here, even if a future PR makes it tempting;
 * surfacing "has attachment" as a derived signal is a privacy-posture
 * change that needs its own ADR.
 */
export function adaptMailMessageRow(row: MailMessageRow): RecentMessage {
  return {
    id: row.id,
    providerMessageId: row.providerMessageId,
    threadId: row.providerThreadId,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.internalDate,
    sizeBytes: row.sizeBytes,
    // Wire omits attachment indicator — default false. Separate decision.
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

const ACTION_LABEL: Record<DecisionHistoryRowDto['action'], DecisionAction> = {
  keep: 'Kept',
  archive: 'Archived',
  unsubscribe: 'Unsubscribe requested',
  later: 'Moved to Later',
  delete: 'Deleted',
  marked_protected: 'Protected',
  unmarked_protected: 'Unprotected',
};

/**
 * `activity_log.source` → who the row names. Only `manual` and
 * `autopilot` are written today; the other two mirror the DB enum so a
 * new producer can't silently render a blank source.
 */
const SOURCE_LABEL: Record<DecisionHistoryRowDto['source'], DecisionSource> = {
  manual: 'You',
  triage: 'Triage',
  autopilot: 'Autopilot',
  screener: 'Screener',
};

/**
 * Wire history row → FE history row. Every field is a fact about
 * something that happened: who acted, what they did, when, and how many
 * messages moved. `count` is left unset for the policy-only verbs so
 * the row doesn't render "· 0 messages" for a Keep or a Protect.
 */
export function adaptDecisionHistoryRow(row: DecisionHistoryRowDto): DecisionHistoryRow {
  return {
    id: row.id,
    at: row.occurredAt,
    source: SOURCE_LABEL[row.source],
    action: ACTION_LABEL[row.action],
    ...(row.affectedCount > 0 ? { count: row.affectedCount } : {}),
    opId: row.id,
  };
}
