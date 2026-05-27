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

import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { and, asc, desc, eq, getTableName, gte, lt, or, sql } from 'drizzle-orm';
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
  LastReview,
  MailMessageRow,
  ProtectionFlags,
  SenderDetail,
  SenderListRow,
  TimeseriesPoint,
  VolumeTrendBucket,
  WeeklyHero,
  WeeklyHeroSenderRow,
  WeeklyHeroSlice,
} from './senders.types.js';
import type { TriageReasoningSource, TriageVerdict } from '@declutrmail/db';

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
    /**
     * Anchor for "current month" used by the volume-trend bucket.
     * Injectable for tests; defaults to `new Date()` in production so
     * controllers don't have to thread the clock through.
     */
    now?: Date;
  }): Promise<SenderListRow[]> {
    const { mailboxAccountId, category, cursor, limit } = args;
    const now = args.now ?? new Date();
    const currentMonthIso = startOfMonthIso(now);
    const priorWindowStartIso = startOfMonthIso(addMonthsUtc(now, -3));

    // Correlated subquery — most-recent timeseries row per sender. We
    // can't LATERAL-join with Drizzle's current builder cleanly, so
    // two scalar subqueries keep the SQL portable across PGlite (test)
    // and postgres-js (prod). Indexed by the timeseries PK
    // `(mailbox_account_id, sender_key, year_month)`, so the
    // `ORDER BY year_month DESC LIMIT 1` is a range-scan tail-read.
    //
    // CORRELATION QUOTE-TRAP. Drizzle's `sql` template emits BARE
    // column names when a `Column` object is interpolated (e.g.
    // `${senders.mailboxAccountId}` renders as `"mailbox_account_id"`,
    // with no table qualifier). Inside this subquery PG's name
    // resolution then binds BOTH sides of the predicate to the inner
    // `sender_timeseries` scope, the WHERE collapses to a tautology,
    // and every outer row gets the same constant timeseries row.
    // Caught in PR #43 → see MISTAKES.md 2026-05-23. The fix is to
    // qualify the outer-scope identifiers explicitly so the
    // correlated reference survives template expansion. We use
    // `getTableName(senders)` + `sql.identifier(...)` rather than a
    // hardcoded `'senders.mailbox_account_id'` string so a future
    // schema rename surfaces as a compile-time miss in this helper
    // instead of a silent re-introduction of the tautology bug.
    const outerMailboxId = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('mailbox_account_id')}`;
    const outerSenderKey = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('sender_key')}`;
    const latestVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const latestReadCountSql = sql<number | null>`(
      SELECT ${senderTimeseries.readCount}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;

    // Trend inputs — pulled in their own indexed subqueries so the
    // bucket computation happens in TypeScript (`computeTrendBucket`)
    // rather than in SQL. Easier to test, easier to extend with new
    // buckets later, and keeps the SQL legible. Each subquery hits
    // the same `(mailbox_account_id, sender_key, year_month)` PK as
    // the latest-month reads above, so the extra cost is one indexed
    // tail-read per subquery per row.
    const currentMonthVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
        AND ${senderTimeseries.yearMonth} = ${currentMonthIso}
      LIMIT 1
    )`;
    // Prior-window average — the 3 complete calendar months immediately
    // before the current one. Cast AVG to float because PG returns it
    // as `numeric` which postgres-js + PGlite hand back as a string;
    // float keeps the TS side type-clean and the rounding harmless
    // (the bucket thresholds are 1.3× / 0.7×, not precision-sensitive).
    const priorAvgVolumeSql = sql<number | null>`(
      SELECT AVG(${senderTimeseries.volume})::float
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
        AND ${senderTimeseries.yearMonth} >= ${priorWindowStartIso}
        AND ${senderTimeseries.yearMonth} < ${currentMonthIso}
    )`;
    // History depth — drives the `new` bucket (fewer than 2 complete
    // months of data). Cast to int for the same string-vs-number
    // reason as the AVG.
    const historyMonthCountSql = sql<number>`(
      SELECT COUNT(*)::int
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
    )`;

    // Last-reviewed inputs — three scalar subqueries against
    // `triage_decisions` for the most-recent (mailbox, sender) row.
    // The current schema enforces ONE row per (mailbox, sender) via
    // a unique index, but the ORDER BY + LIMIT 1 keeps us forward-
    // compatible with the planned `triage_decision_history` table
    // (referenced in the triage-decisions schema header). Per
    // ADR-0008 §3 the senders read service is allowed to touch
    // `triage_decisions` directly until the triage feature outgrows
    // its single-table footprint.
    const lastDecisionAtSql = sql<Date | null>`(
      SELECT ${triageDecisions.producedAt}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;
    const lastDecisionVerdictSql = sql<TriageVerdict | null>`(
      SELECT ${triageDecisions.verdict}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;
    const lastDecisionGeneratedBySql = sql<TriageReasoningSource | null>`(
      SELECT ${triageDecisions.generatedBy}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
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
        currentMonthVolume: currentMonthVolumeSql,
        priorAvgVolume: priorAvgVolumeSql,
        historyMonthCount: historyMonthCountSql,
        lastDecisionAt: lastDecisionAtSql,
        lastDecisionVerdict: lastDecisionVerdictSql,
        lastDecisionGeneratedBy: lastDecisionGeneratedBySql,
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
      volumeTrend: computeTrendBucket(
        row.currentMonthVolume,
        row.priorAvgVolume,
        row.historyMonthCount,
      ),
      unsubscribeMethod: row.unsubscribeMethod,
      lastReview: buildLastReview(
        row.lastDecisionAt,
        row.lastDecisionVerdict,
        row.lastDecisionGeneratedBy,
      ),
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
  async getSenderDetail(
    mailboxAccountId: string,
    senderId: string,
    args: { now?: Date } = {},
  ): Promise<SenderDetail | null> {
    // Same correlated subqueries as the list to keep the read shape
    // consistent. A LATERAL join would be more efficient at very high
    // scale but is overkill at the per-row single-fetch path; the
    // FE only calls this once per page navigation.
    //
    // See the matching comment in `listSenders` for why the outer-scope
    // references are built via `sql.identifier(getTableName(senders))`
    // rather than bare `${senders.column}` interpolations, and for the
    // trend-bucket / last-reviewed subquery rationale.
    const now = args.now ?? new Date();
    const currentMonthIso = startOfMonthIso(now);
    const priorWindowStartIso = startOfMonthIso(addMonthsUtc(now, -3));
    const outerMailboxId = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('mailbox_account_id')}`;
    const outerSenderKey = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('sender_key')}`;
    const latestVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const latestReadCountSql = sql<number | null>`(
      SELECT ${senderTimeseries.readCount}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const currentMonthVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
        AND ${senderTimeseries.yearMonth} = ${currentMonthIso}
      LIMIT 1
    )`;
    const priorAvgVolumeSql = sql<number | null>`(
      SELECT AVG(${senderTimeseries.volume})::float
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
        AND ${senderTimeseries.yearMonth} >= ${priorWindowStartIso}
        AND ${senderTimeseries.yearMonth} < ${currentMonthIso}
    )`;
    const historyMonthCountSql = sql<number>`(
      SELECT COUNT(*)::int
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
    )`;
    const lastDecisionAtSql = sql<Date | null>`(
      SELECT ${triageDecisions.producedAt}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;
    const lastDecisionVerdictSql = sql<TriageVerdict | null>`(
      SELECT ${triageDecisions.verdict}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;
    const lastDecisionGeneratedBySql = sql<TriageReasoningSource | null>`(
      SELECT ${triageDecisions.generatedBy}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
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
        currentMonthVolume: currentMonthVolumeSql,
        priorAvgVolume: priorAvgVolumeSql,
        historyMonthCount: historyMonthCountSql,
        lastDecisionAt: lastDecisionAtSql,
        lastDecisionVerdict: lastDecisionVerdictSql,
        lastDecisionGeneratedBy: lastDecisionGeneratedBySql,
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
      volumeTrend: computeTrendBucket(
        row.currentMonthVolume,
        row.priorAvgVolume,
        row.historyMonthCount,
      ),
      unsubscribeMethod: row.unsubscribeMethod,
      lastReview: buildLastReview(
        row.lastDecisionAt,
        row.lastDecisionVerdict,
        row.lastDecisionGeneratedBy,
      ),
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
      confidence: (() => {
        const n = Number.parseFloat(row.confidence);
        if (!Number.isFinite(n)) {
          throw new InternalServerErrorException(
            `Triage decision ${row.id} has invalid confidence value: ${row.confidence}`,
          );
        }
        return n;
      })(),
      producedAt: row.producedAt.toISOString(),
      reasoning: row.reasoning,
      generatedBy: row.generatedBy,
    }));
  }

  /**
   * Compute the three Weekly Hero slices for a mailbox (D47, D48).
   *
   * Slices, per D48:
   *   1. high_confidence — engine confidence > 0.85 on archive/unsubscribe
   *      verdicts, sorted by latest monthly volume desc, cap 24.
   *   2. spike — current month volume ≥ 3× prior-3-month average,
   *      sorted by ratio desc, cap 24.
   *   3. quiet — last_seen > 30d ago, read_rate < 0.30, first_seen ≥
   *      6 months, sorted by `monthly_volume × first_seen_months` desc,
   *      cap 24.
   *
   * Each slice is computed in a single SELECT against `senders` +
   * correlated `sender_timeseries` reads. Slices with < 3 qualifying
   * senders are OMITTED from the response — the FE iterates the
   * returned slices unconditionally (D48 — "If any slice has < 3
   * senders, the card hides itself").
   *
   * `isMonday` and `weekOf` are computed in TS from the optional `now`
   * anchor; the BE always computes the freshest slices and the FE
   * decides whether to surface the Hero based on `isMonday`. Surfacing
   * the Hero only on Mondays is a presentation choice (D47), not a
   * cadence-of-computation one.
   *
   * Sparklines are loaded in a single batched SELECT against
   * `sender_timeseries` after the slice members are determined — N+1
   * avoidance. The slice rows ride a small set of UUIDs through the
   * WHERE clause so the index `(mailbox_account_id, sender_key,
   * year_month)` PK serves the read directly.
   *
   * SUBQUERY CORRELATION (MISTAKES.md 2026-05-23). Outer-scope
   * `senders.mailbox_account_id` and `senders.sender_key` references
   * inside correlated subqueries use `sql.identifier(getTableName(senders))`
   * — bare `${senders.col}` would degenerate to a tautology and silently
   * collapse the tenant boundary. The spec covers this with a
   * cross-mailbox `sender_key` collision regression case.
   */
  async listWeeklyHero(args: {
    mailboxAccountId: string;
    /** Anchor for "now" — injectable for tests. Defaults to `new Date()`. */
    now?: Date;
  }): Promise<WeeklyHero> {
    const { mailboxAccountId } = args;
    const now = args.now ?? new Date();
    const currentMonthIso = startOfMonthIso(now);
    const priorWindowStartIso = startOfMonthIso(addMonthsUtc(now, -3));
    const sparklineStart = startOfMonthMonthsAgo(now, 11);
    const sparklineStartIso = sparklineStart.toISOString().slice(0, 10);
    const longQuietCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = addMonthsUtc(now, -6);

    // Outer-scope identifiers for correlated subqueries (see MISTAKES.md
    // 2026-05-23 + the matching block in `listSenders`).
    const outerMailboxId = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('mailbox_account_id')}`;
    const outerSenderKey = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('sender_key')}`;

    const latestVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const latestReadCountSql = sql<number | null>`(
      SELECT ${senderTimeseries.readCount}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
      ORDER BY ${senderTimeseries.yearMonth} DESC
      LIMIT 1
    )`;
    const currentMonthVolumeSql = sql<number | null>`(
      SELECT ${senderTimeseries.volume}
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
        AND ${senderTimeseries.yearMonth} = ${currentMonthIso}
      LIMIT 1
    )`;
    const priorAvgVolumeSql = sql<number | null>`(
      SELECT AVG(${senderTimeseries.volume})::float
      FROM ${senderTimeseries}
      WHERE ${senderTimeseries.mailboxAccountId} = ${outerMailboxId}
        AND ${senderTimeseries.senderKey} = ${outerSenderKey}
        AND ${senderTimeseries.yearMonth} >= ${priorWindowStartIso}
        AND ${senderTimeseries.yearMonth} < ${currentMonthIso}
    )`;
    // Confidence subquery — the most-recent triage decision's
    // confidence. Stored as `numeric(3,2)`; cast to float for the
    // > 0.85 comparison in TS (postgres-js + PGlite return numerics as
    // strings).
    const latestConfidenceSql = sql<string | null>`(
      SELECT ${triageDecisions.confidence}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;
    const latestVerdictSql = sql<'keep' | 'archive' | 'unsubscribe' | 'later' | null>`(
      SELECT ${triageDecisions.verdict}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;

    // One SELECT pulls every column the three slices need — keeps the
    // round-trip count to 2 (1 for candidates + 1 for sparklines) per
    // hero render, regardless of slice cardinality.
    const candidates = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        displayName: senders.displayName,
        email: senders.email,
        domain: senders.domain,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
        latestVolume: latestVolumeSql,
        latestReadCount: latestReadCountSql,
        currentMonthVolume: currentMonthVolumeSql,
        priorAvgVolume: priorAvgVolumeSql,
        latestConfidence: latestConfidenceSql,
        latestVerdict: latestVerdictSql,
      })
      .from(senders)
      .where(eq(senders.mailboxAccountId, mailboxAccountId));

    const SLICE_MAX = 24;
    const SLICE_MIN = 3;

    // High-confidence slice — engine recommends archive/unsubscribe AND
    // confidence > 0.85. Sort by latest monthly volume desc (highest
    // noise first), per D48.
    const highConfidence = candidates
      .filter((c) => {
        if (c.latestVerdict !== 'archive' && c.latestVerdict !== 'unsubscribe') return false;
        if (c.latestConfidence === null) return false;
        const conf = Number.parseFloat(c.latestConfidence);
        if (!Number.isFinite(conf)) return false;
        return conf > 0.85;
      })
      .sort((a, b) => (b.latestVolume ?? 0) - (a.latestVolume ?? 0));

    // Spike slice — current month ≥ 3× prior 3-month average. Skip
    // senders with no prior baseline (prevents division-by-zero "new
    // sender" senders from polluting spike — they belong in their own
    // cohort, not here).
    const spike = candidates
      .map((c) => {
        const current = c.currentMonthVolume ?? 0;
        const prior = c.priorAvgVolume ?? 0;
        const ratio = prior > 0 ? current / prior : 0;
        return { c, ratio };
      })
      .filter((row) => {
        const prior = row.c.priorAvgVolume ?? 0;
        // Require non-trivial baseline so a sender jumping 1 → 4 doesn't
        // surface as a "spike" — a single message is noise, not signal.
        if (prior < 1) return false;
        return row.ratio >= 3;
      })
      .sort((a, b) => b.ratio - a.ratio)
      .map((row) => row.c);

    // Long-quiet slice — last_seen ≥ 30 days ago, read_rate < 30%,
    // relationship ≥ 6 months (D48 — "only surface senders the user
    // has had inbox presence with for ≥ 6 months — no surprises").
    const quiet = candidates
      .filter((c) => {
        if (c.lastSeenAt >= longQuietCutoff) return false;
        if (c.firstSeenAt >= sixMonthsAgo) return false;
        const vol = c.latestVolume ?? 0;
        if (vol === 0) return false;
        const rate = (c.latestReadCount ?? 0) / vol;
        return rate < 0.3;
      })
      .map((c) => {
        // Sort key per D48: monthly_volume × first_seen_months (target
        // senders that were noisy when active).
        const monthsActive = Math.max(
          1,
          Math.floor((now.getTime() - c.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24 * 30)),
        );
        return { c, sortKey: (c.latestVolume ?? 0) * monthsActive };
      })
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((row) => row.c);

    // Pick the top N members per slice and build a single de-duped key
    // set for the batched sparkline read.
    const sliceMembers = {
      high_confidence: highConfidence,
      spike,
      quiet,
    } as const;

    const allSenderKeys = new Set<string>();
    for (const kind of ['high_confidence', 'spike', 'quiet'] as const) {
      if (sliceMembers[kind].length < SLICE_MIN) continue;
      for (const member of sliceMembers[kind].slice(0, SLICE_MAX)) {
        allSenderKeys.add(member.senderKey);
      }
    }

    // Batch-load 12 months of timeseries for every member in any
    // included slice. One indexed SELECT, no N+1.
    const sparkPoints =
      allSenderKeys.size === 0
        ? []
        : await this.db
            .select({
              senderKey: senderTimeseries.senderKey,
              yearMonth: senderTimeseries.yearMonth,
              volume: senderTimeseries.volume,
            })
            .from(senderTimeseries)
            .where(
              and(
                eq(senderTimeseries.mailboxAccountId, mailboxAccountId),
                gte(senderTimeseries.yearMonth, sparklineStartIso),
              ),
            )
            .orderBy(asc(senderTimeseries.yearMonth));

    // Build 12-month sparklines per sender. Months without a row fill
    // with 0 so every sparkline is exactly 12 numbers.
    const sparklineByKey = new Map<string, number[]>();
    const monthSlots = build12MonthSlots(now); // YYYY-MM in chronological order
    for (const point of sparkPoints) {
      if (!allSenderKeys.has(point.senderKey)) continue;
      const slot = monthSlots.indexOf(point.yearMonth.slice(0, 7));
      if (slot === -1) continue;
      let series = sparklineByKey.get(point.senderKey);
      if (!series) {
        series = new Array<number>(12).fill(0);
        sparklineByKey.set(point.senderKey, series);
      }
      series[slot] = point.volume;
    }

    const slices: WeeklyHeroSlice[] = [];
    for (const kind of ['high_confidence', 'spike', 'quiet'] as const) {
      const members = sliceMembers[kind];
      if (members.length < SLICE_MIN) continue;
      const capped = members.slice(0, SLICE_MAX);
      const rows: WeeklyHeroSenderRow[] = capped.map((m) => {
        const vol = m.latestVolume ?? 0;
        const reads = m.latestReadCount ?? 0;
        return {
          id: m.id,
          displayName: m.displayName,
          email: m.email,
          domain: m.domain,
          monthlyVolume: vol,
          readRate: vol === 0 ? null : Math.round((reads / vol) * 100) / 100,
          sparkline: sparklineByKey.get(m.senderKey) ?? new Array<number>(12).fill(0),
        };
      });
      slices.push({
        kind,
        totalCount: members.length,
        senders: rows,
      });
    }

    return {
      isMonday: now.getUTCDay() === 1,
      weekOf: mondayOfWeekIso(now),
      slices,
    };
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

/**
 * Pure helper — add `n` months to the provided anchor (negative = back
 * in time) and return a new `Date` anchored to UTC. Wrapper around
 * `Date.UTC(y, m + n, 1)` so the SQL-side `year_month` boundary string
 * is consistent across DST / locale shifts.
 */
function addMonthsUtc(anchor: Date, n: number): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + n, 1));
}

/**
 * Pure helper — render a UTC Date as the first-of-month `YYYY-MM-DD`
 * string used by `sender_timeseries.year_month`. Centralised so the
 * trend-window subqueries above stay readable and the format is
 * impossible to drift across helpers.
 */
function startOfMonthIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/**
 * Pure helper — build the 12-slot chronological list of `YYYY-MM`
 * strings ending at the current month. Used to project each sparkline
 * read into a fixed-length 12-number array. Kept centralised so the
 * sparkline slot index agrees with the SQL window boundary.
 */
function build12MonthSlots(anchor: Date): string[] {
  const slots: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = addMonthsUtc(anchor, -i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    slots.push(`${y}-${m}`);
  }
  return slots;
}

/**
 * Pure helper — return the Monday of the week containing `d` as
 * `YYYY-MM-DD` in UTC. Used for the Weekly Hero header "Week of …"
 * copy. UTC anchoring is a pragmatic launch choice — a per-mailbox
 * timezone is the documented eventual home but requires adding a
 * `timezone` column to `mailbox_accounts` (out of scope here).
 */
function mondayOfWeekIso(d: Date): string {
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. Shift so Monday=0.
  const dow = d.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(d.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pure helper — map the raw timeseries inputs to one of the bucketed
 * trend labels (`VolumeTrendBucket`) the FE renders. Centralising the
 * thresholds here keeps the SQL clean and gives the bucket logic a
 * single unit-tested home.
 *
 * Bucket order matters — the early returns encode the precedence:
 *
 *   1. No history at all                 → null   ("—" on FE)
 *   2. < 2 months of history             → 'new'
 *   3. Prior average is zero (gap)       → 'up' if current > 0 else null
 *   4. Current is zero, prior > 0        → 'dormant'
 *   5. current ≥ prior × 1.3             → 'up'
 *   6. current ≤ prior × 0.7             → 'down'
 *   7. otherwise                         → 'steady'
 *
 * The 1.3× / 0.7× thresholds are placeholders pending ratification
 * against real mailbox variance (flagged in MISTAKES.md / brief).
 * They are deliberately centralised so a single edit re-buckets every
 * surface.
 */
function computeTrendBucket(
  currentVolume: number | null,
  priorAvg: number | null,
  historyMonthCount: number,
): VolumeTrendBucket | null {
  if (historyMonthCount === 0) return null;
  if (historyMonthCount < 2) return 'new';
  const current = currentVolume ?? 0;
  const prior = priorAvg ?? 0;
  if (prior === 0) {
    return current > 0 ? 'up' : null;
  }
  if (current === 0) return 'dormant';
  if (current >= prior * 1.3) return 'up';
  if (current <= prior * 0.7) return 'down';
  return 'steady';
}

/**
 * Pure helper — assemble a `LastReview` from the three optional
 * scalar-subquery columns. All three are populated together (same
 * `triage_decisions` row) or all null. If `at` is set the other two
 * MUST be set; the helper treats partial population as a contract
 * violation surfaced as null rather than a partial object so the FE
 * never has to defensive-check intermediate fields.
 */
function buildLastReview(
  at: Date | string | null,
  verdict: TriageVerdict | null,
  generatedBy: TriageReasoningSource | null,
): LastReview | null {
  if (at === null || verdict === null || generatedBy === null) {
    return null;
  }
  // Scalar correlated subqueries on a `timestamptz` column come back
  // as strings from postgres-js + PGlite (no Drizzle column-type
  // coercion in scalar `sql<>` contexts), even though the TS template
  // type promises `Date`. Normalise via `new Date(...)` so a future
  // driver change that DOES coerce to `Date` doesn't break us either.
  const asDate = at instanceof Date ? at : new Date(at);
  return {
    at: asDate.toISOString(),
    verdict,
    generatedBy,
  };
}
