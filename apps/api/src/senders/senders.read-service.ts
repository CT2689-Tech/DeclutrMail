// apps/api/src/senders/senders.read-service.ts — owns the SELECTs for
// the Senders feature (D39, D40, D44, D45, D46).
//
// Per D204 / ADR-0008, this is the ONLY place outside migrations that
// queries `senders`, `sender_timeseries`, `sender_policies`, and
// `mail_messages` for the senders feature. Cross-feature reads are
// supposed to happen via projection of domain events into the
// consuming feature's own table — see ADR-0008 §3.
//
// PRAGMATIC EXCEPTION (ADR-0008 §3): this service ALSO reads
// `triage_decisions` directly to populate the decision-history
// endpoint. Documented as a launch-pragmatic compromise; the
// alternative — emit-and-project — adds operational complexity before
// we know the access pattern. Flagged for ratification when the
// triage feature grows past its current single-table footprint.
//
// PRIVACY (D7, D228): every column read here is on the storage
// allowlist. The service NEVER fetches from Gmail, NEVER returns body
// content, NEVER returns non-allowlisted headers. The
// `mail_messages.snippet` column IS allowlisted (and capped at
// varchar(300) at the schema level) — it can flow through.

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import {
  mailMessages,
  senderPolicies,
  senderTimeseries,
  senders,
  triageDecisions,
} from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  DecisionHistoryRow,
  GmailCategory,
  MailMessageRow,
  ProtectionFlags,
  SenderDetail,
  SenderListRow,
  TimeseriesPoint,
} from './senders.types.js';

/**
 * Service-internal cursor shape — keyset on `(sort_col, id)` per D202.
 *
 * Kept distinct from the wire `DecodedCursor` (which is `{key, id}`
 * strings) so callers can pass typed Date / number boundaries
 * without re-parsing inside the SELECT builder. The controller
 * encodes/decodes between this and the opaque wire token.
 */
export interface SenderListCursor {
  /** ISO-8601 boundary `last_seen_at` of the last item on the prior page. */
  lastSeenAt: Date;
  /** Tie-breaker — sender id of that same boundary row. */
  id: string;
}

export interface MessagesCursor {
  /** ISO-8601 boundary `internal_date` of the last item on the prior page. */
  internalDate: Date;
  /** Tie-breaker — message id of that same boundary row. */
  id: string;
}

export interface HistoryCursor {
  /** ISO-8601 boundary `produced_at` of the last item on the prior page. */
  producedAt: Date;
  /** Tie-breaker — decision id of that same boundary row. */
  id: string;
}

@Injectable()
export class SendersReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * List senders for one mailbox, paginated by `last_seen_at` DESC
   * with `id` as the tie-breaker. Optional `category` filter mirrors
   * Gmail's own category (D39 — sender cohorts on the list view).
   *
   * The query left-joins the most-recent month from `sender_timeseries`
   * via a correlated subquery so the list row's `monthlyVolume` /
   * `readRate` are filled in one round-trip. Senders with no
   * timeseries rows yet (sync hasn't run `building_sender_index`) get
   * `monthlyVolume = null`; the FE renders that as a "—".
   *
   * Returns one EXTRA row beyond `limit` so the controller can derive
   * `hasMore` without a second `count(*)` — the +1 sentinel pattern
   * recommended by D202.
   */
  async listSenders(args: {
    mailboxAccountId: string;
    category: GmailCategory | null;
    cursor: SenderListCursor | null;
    /** Honored limit (already clamped by the controller). */
    limit: number;
  }): Promise<SenderListRow[]> {
    const { mailboxAccountId, category, cursor, limit } = args;

    // Correlated subquery — most-recent timeseries row per sender. We
    // can't LATERAL-join with Drizzle's current builder cleanly, so
    // two scalar subqueries keep the SQL portable across PGlite (test)
    // and postgres-js (prod). Indexed by the timeseries PK
    // `(mailbox_account_id, sender_key, year_month)`, so the
    // `ORDER BY year_month DESC LIMIT 1` is a range-scan tail-read.
    const latestVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${senders.mailboxAccountId}
        AND ${senderTimeseries.senderKey} = ${senders.senderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const latestReadCountSql = sql<number | null>`(
      SELECT ${senderTimeseries.readCount}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${senders.mailboxAccountId}
        AND ${senderTimeseries.senderKey} = ${senders.senderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;

    // Keyset predicate — `(last_seen_at, id) < (cursor.lastSeenAt,
    // cursor.id)` expressed as the equivalent OR-chain so PG can use
    // the `(mailbox_account_id, last_seen_at, id)` candidate index.
    // The senders table doesn't carry that exact composite today
    // (only `(mailbox_account_id, category)` is explicit), but the
    // mailbox-equality predicate keeps the scan bounded; a future
    // index migration is straightforward when we see a slow page.
    const conditions = [eq(senders.mailboxAccountId, mailboxAccountId)];
    if (category) {
      conditions.push(eq(senders.gmailCategory, category));
    }
    if (cursor) {
      conditions.push(
        or(
          lt(senders.lastSeenAt, cursor.lastSeenAt),
          and(eq(senders.lastSeenAt, cursor.lastSeenAt), lt(senders.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: senders.id,
        displayName: senders.displayName,
        email: senders.email,
        domain: senders.domain,
        gmailCategory: senders.gmailCategory,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
        unsubscribeMethod: senders.unsubscribeMethod,
        latestVolume: latestVolumeSql,
        latestReadCount: latestReadCountSql,
      })
      .from(senders)
      .where(and(...conditions))
      // Two-column DESC ordering matches the cursor predicate so the
      // page boundary is deterministic even when multiple senders
      // share `last_seen_at` to the second (rare but possible at
      // first-sync time).
      .orderBy(desc(senders.lastSeenAt), desc(senders.id))
      // +1 sentinel — the controller pops the extra row to set
      // `hasMore` without a count query.
      .limit(limit + 1);

    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      domain: row.domain,
      gmailCategory: row.gmailCategory,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      monthlyVolume: row.latestVolume,
      readRate: computeReadRate(row.latestVolume, row.latestReadCount),
      unsubscribeMethod: row.unsubscribeMethod,
    }));
  }

  /**
   * Fetch one sender by id, scoped to the caller's mailbox.
   *
   * Returns `null` if the sender doesn't exist OR belongs to a
   * different mailbox — the controller maps `null` to HTTP 404 so we
   * don't leak existence across tenants. Per the architecture-
   * guardian rule, mailbox isolation is enforced by the WHERE clause
   * here, not by a guard above us.
   */
  async getSenderDetail(mailboxAccountId: string, senderId: string): Promise<SenderDetail | null> {
    // Same correlated subqueries as the list to keep the read shape
    // consistent. A LATERAL join would be more efficient at very high
    // scale but is overkill at the per-row single-fetch path; the
    // FE only calls this once per page navigation.
    const latestVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${senders.mailboxAccountId}
        AND ${senderTimeseries.senderKey} = ${senders.senderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const latestReadCountSql = sql<number | null>`(
      SELECT ${senderTimeseries.readCount}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${senders.mailboxAccountId}
        AND ${senderTimeseries.senderKey} = ${senders.senderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;

    const [row] = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        displayName: senders.displayName,
        email: senders.email,
        domain: senders.domain,
        gmailCategory: senders.gmailCategory,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
        unsubscribeMethod: senders.unsubscribeMethod,
        latestVolume: latestVolumeSql,
        latestReadCount: latestReadCountSql,
        // Policy fields nullable — a sender without an explicit
        // policy row is "engine default" (D42).
        isVip: senderPolicies.isVip,
        isProtected: senderPolicies.isProtected,
        protectionReason: senderPolicies.protectionReason,
        protectionSetAt: senderPolicies.protectionSetAt,
      })
      .from(senders)
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, senders.mailboxAccountId),
          eq(senderPolicies.senderKey, senders.senderKey),
        ),
      )
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);

    if (!row) {
      return null;
    }

    const protectionFlags: ProtectionFlags = {
      isVip: row.isVip ?? false,
      isProtected: row.isProtected ?? false,
      protectionReason: row.protectionReason ?? null,
      protectionSetAt: row.protectionSetAt ? row.protectionSetAt.toISOString() : null,
    };

    return {
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      domain: row.domain,
      gmailCategory: row.gmailCategory,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      monthlyVolume: row.latestVolume,
      readRate: computeReadRate(row.latestVolume, row.latestReadCount),
      unsubscribeMethod: row.unsubscribeMethod,
      protectionFlags,
    };
  }

  /**
   * Recent messages from one sender, newest first, keyset-paginated.
   *
   * Two-step resolve: first look up the sender's `sender_key` (mailbox-
   * scoped, returns null on mismatch), then fetch the messages keyed
   * by `(mailbox_account_id, sender_key)`. The indirection keeps the
   * tenant boundary explicit — a malformed senderId or a foreign-
   * mailbox senderId returns `null` from `resolveSenderKey` and the
   * messages page is never queried.
   *
   * Index: `mail_messages_account_sender_date_idx` covers the WHERE
   * and the ORDER BY exactly.
   */
  async listMessagesForSender(args: {
    mailboxAccountId: string;
    senderId: string;
    cursor: MessagesCursor | null;
    limit: number;
  }): Promise<MailMessageRow[] | null> {
    const { mailboxAccountId, senderId, cursor, limit } = args;
    const senderKey = await this.resolveSenderKey(mailboxAccountId, senderId);
    if (senderKey === null) {
      return null;
    }

    const conditions = [
      eq(mailMessages.mailboxAccountId, mailboxAccountId),
      eq(mailMessages.senderKey, senderKey),
    ];
    if (cursor) {
      conditions.push(
        or(
          lt(mailMessages.internalDate, cursor.internalDate),
          and(eq(mailMessages.internalDate, cursor.internalDate), lt(mailMessages.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: mailMessages.id,
        providerMessageId: mailMessages.providerMessageId,
        providerThreadId: mailMessages.providerThreadId,
        subject: mailMessages.subject,
        snippet: mailMessages.snippet,
        internalDate: mailMessages.internalDate,
        isUnread: mailMessages.isUnread,
      })
      .from(mailMessages)
      .where(and(...conditions))
      .orderBy(desc(mailMessages.internalDate), desc(mailMessages.id))
      .limit(limit + 1);

    return rows.map((row) => ({
      id: row.id,
      providerMessageId: row.providerMessageId,
      providerThreadId: row.providerThreadId,
      subject: row.subject,
      snippet: row.snippet,
      internalDate: row.internalDate.toISOString(),
      isUnread: row.isUnread,
    }));
  }

  /**
   * Past 12 calendar months of `sender_timeseries` for one sender.
   *
   * Returns rows in chronological order (oldest → newest) so the FE
   * can render the sparkline without resorting. Months with NO row
   * in the table are simply absent — the FE fills 0s where it needs
   * a continuous x-axis (the alternative, generating a row per month
   * in the DB, requires a `generate_series` join that PGlite doesn't
   * support uniformly; the FE-side fill is one `Map` lookup).
   *
   * Returns `null` if the sender id doesn't resolve in this mailbox
   * (same 404 path as `listMessagesForSender`).
   */
  async listTimeseries(args: {
    mailboxAccountId: string;
    senderId: string;
    /** Anchor for the 12-month window — defaults to "now"; injectable for tests. */
    now?: Date;
  }): Promise<TimeseriesPoint[] | null> {
    const { mailboxAccountId, senderId } = args;
    const senderKey = await this.resolveSenderKey(mailboxAccountId, senderId);
    if (senderKey === null) {
      return null;
    }

    // 12-month window — boundary is the first day of the month 11
    // months ago, so the current month is the 12th included month.
    const now = args.now ?? new Date();
    const windowStart = startOfMonthMonthsAgo(now, 11);
    // `year_month` is `mode: 'string'` (YYYY-MM-DD); compare as ISO date.
    const windowStartIso = windowStart.toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        yearMonth: senderTimeseries.yearMonth,
        volume: senderTimeseries.volume,
        readCount: senderTimeseries.readCount,
      })
      .from(senderTimeseries)
      .where(
        and(
          eq(senderTimeseries.mailboxAccountId, mailboxAccountId),
          eq(senderTimeseries.senderKey, senderKey),
          gte(senderTimeseries.yearMonth, windowStartIso),
        ),
      )
      .orderBy(asc(senderTimeseries.yearMonth));

    return rows.map((row) => ({
      // `year_month` is stored as the 1st of the month (YYYY-MM-01);
      // project to the FE's expected `YYYY-MM` shape.
      yearMonth: row.yearMonth.slice(0, 7),
      volume: row.volume,
      readCount: row.readCount,
    }));
  }

  /**
   * Decision history for one sender — most recent first, keyset-
   * paginated by `produced_at` DESC + `id` DESC.
   *
   * The current `triage_decisions` schema enforces ONE row per
   * (mailbox, sender) via a unique index; pagination here is
   * future-proofing for when a `triage_decision_history` table lands
   * (referenced in the schema header). The contract stays uniform so
   * the FE doesn't need to special-case "history of one".
   *
   * See ADR-0008 §3 — this is the launch-pragmatic exception that
   * lets the senders read service touch a triage-owned table
   * directly. The migration path (emit event → project into a
   * senders-owned `sender_decision_history` projection) is flagged
   * for ratification when triage outgrows its single-table footprint.
   */
  async listDecisionHistory(args: {
    mailboxAccountId: string;
    senderId: string;
    cursor: HistoryCursor | null;
    limit: number;
  }): Promise<DecisionHistoryRow[] | null> {
    const { mailboxAccountId, senderId, cursor, limit } = args;
    const senderKey = await this.resolveSenderKey(mailboxAccountId, senderId);
    if (senderKey === null) {
      return null;
    }

    const conditions = [
      eq(triageDecisions.mailboxAccountId, mailboxAccountId),
      eq(triageDecisions.senderKey, senderKey),
    ];
    if (cursor) {
      conditions.push(
        or(
          lt(triageDecisions.producedAt, cursor.producedAt),
          and(eq(triageDecisions.producedAt, cursor.producedAt), lt(triageDecisions.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: triageDecisions.id,
        verdict: triageDecisions.verdict,
        confidence: triageDecisions.confidence,
        producedAt: triageDecisions.producedAt,
        reasoning: triageDecisions.reasoning,
        generatedBy: triageDecisions.generatedBy,
      })
      .from(triageDecisions)
      .where(and(...conditions))
      .orderBy(desc(triageDecisions.producedAt), desc(triageDecisions.id))
      .limit(limit + 1);

    return rows.map((row) => ({
      id: row.id,
      verdict: row.verdict,
      // Drizzle's numeric column returns a string to preserve
      // precision (postgres-js + PGlite both); convert at the
      // boundary so the wire is a plain number with 2-decimal
      // precision matching the column's `numeric(3,2)` storage.
      confidence: Number.parseFloat(row.confidence),
      producedAt: row.producedAt.toISOString(),
      reasoning: row.reasoning,
      generatedBy: row.generatedBy,
    }));
  }

  /**
   * Resolve a sender row id to its `sender_key` within a mailbox.
   *
   * Returns `null` when the sender doesn't exist OR belongs to a
   * different mailbox — the canonical tenant-isolation pattern used
   * by every per-sender endpoint above. The single SELECT here is
   * the SAME check `getSenderDetail` makes; we keep them separate
   * so the messages/timeseries/history endpoints can short-circuit
   * to a 404 without paying for the full join.
   */
  private async resolveSenderKey(
    mailboxAccountId: string,
    senderId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ senderKey: senders.senderKey })
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    return row?.senderKey ?? null;
  }
}

/**
 * Pure helper — derive the displayed read rate from the latest
 * month's volume and read count. Returns `null` when `volume` is
 * null (no timeseries yet) or zero (cannot divide), so the FE
 * renders an explicit "—" instead of a misleading "0%".
 *
 * Rounded to 2 decimal places — matches the `numeric(3,2)` rounding
 * on the engine's confidence column for visual consistency.
 */
function computeReadRate(volume: number | null, readCount: number | null): number | null {
  if (volume === null || volume === 0) return null;
  const readSafe = readCount ?? 0;
  const raw = readSafe / volume;
  // Round to 2 decimals — matches `Math.round(x * 100) / 100` idiom.
  return Math.round(raw * 100) / 100;
}

/**
 * Pure helper — first day of the calendar month `n` months before the
 * provided anchor, in UTC. Used to compute the 12-month window
 * boundary for the timeseries endpoint.
 *
 * UTC anchoring matches the column's `mode: 'string'` storage of
 * `year_month` (which is timezone-agnostic — it's just `YYYY-MM-DD`
 * representing the first of the month).
 */
function startOfMonthMonthsAgo(anchor: Date, n: number): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - n, 1));
}
