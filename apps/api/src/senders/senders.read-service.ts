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

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  getTableName,
  gt,
  gte,
  ilike,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
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
  SenderListDirection,
  SenderListQueryMeta,
  SenderListRow,
  SenderListSort,
  TimeseriesPoint,
  VolumeTrendBucket,
  WeeklyHero,
  WeeklyHeroSenderRow,
  WeeklyHeroSlice,
} from './senders.types.js';
import type { TriageReasoningSource, TriageVerdict } from '@declutrmail/db';

/**
 * Sorts the service implements at Slice 1. `read` and `recommended` are
 * advertised by the contract but deferred — see `SenderListSort` doc
 * in `senders.types.ts`. The controller maps an unsupported sort to
 * `400`; the service throws if the controller's filter slipped.
 */
const SUPPORTED_SORTS: ReadonlySet<SenderListSort> = new Set([
  'total',
  'last_seen',
  'first_seen',
  'name',
]);

/** Default direction per sort when the caller omits `direction`. */
const DEFAULT_DIRECTION_BY_SORT: Record<SenderListSort, SenderListDirection> = {
  total: 'desc',
  last_seen: 'desc',
  first_seen: 'desc',
  name: 'asc',
  read: 'desc',
  recommended: 'desc',
};

/**
 * Build the server-side search predicate for the senders list (#145).
 * Matches the query case-insensitively (substring) against the three
 * metadata fields the list shows — display name, email, domain — so a
 * search resolves across the WHOLE mailbox, not just the loaded page the
 * FE used to filter client-side. D7-safe: metadata only.
 *
 * User input is treated literally — LIKE wildcards (`%` `_`) and the
 * escape char (`\`) are escaped so a query like `50%` can't become a
 * match-all. PG's default LIKE escape is backslash, so no ESCAPE clause
 * is needed (and PGlite honors the same default in tests).
 */
function buildSenderSearchCondition(q: string | null | undefined): SQL | null {
  const term = (q ?? '').trim();
  if (term.length === 0) return null;
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  return (
    or(
      ilike(senders.displayName, pattern),
      ilike(senders.email, pattern),
      ilike(senders.domain, pattern),
    ) ?? null
  );
}

/**
 * Service-internal cursor shape — keyset on `(sort_col, id)` per D202.
 *
 * The wire `DecodedCursor` is `{ key: string; id: string }`; the
 * service parses `key` per the active `sort` (ISO date for time
 * columns, numeric string for total, plain string for name). Carrying
 * the raw string through keeps the controller's encode/decode logic
 * uniform across columns — each sort's expected `key` shape is
 * documented at the call site in `buildCursorPredicate`.
 */
export interface SenderListCursor {
  /** Sort-column value at the page boundary, opaque string per `sort`. */
  key: string;
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
    /**
     * When `true`, return only senders with a standing Protect policy
     * (`sender_policies.is_protected = true`). When `null`/omitted, no
     * filter. Backs the Settings → Standing Policies surface so it can
     * page protected senders server-side instead of fetching the whole
     * mailbox client-side and filtering. See ADR-0014 + the senders list
     * contract.
     */
    isProtected?: boolean | null;
    /**
     * Sortable column — Slice 1 supports `total` | `last_seen` |
     * `first_seen` | `name`. Defaults to `'total'` per the senders
     * list contract — the new "flood" headline. `read` / `recommended`
     * are reserved in the contract but deferred (see SUPPORTED_SORTS).
     */
    sort?: SenderListSort | null;
    /**
     * Sort direction. When omitted, falls back to
     * `DEFAULT_DIRECTION_BY_SORT[sort]` — desc for the time + total
     * columns, asc for `name`.
     */
    direction?: SenderListDirection | null;
    cursor: SenderListCursor | null;
    /** Honored limit (already clamped by the controller). */
    limit: number;
    /**
     * Server-side search (#145). Case-insensitive substring over display
     * name / email / domain, mailbox-scoped, combined with the other
     * filters + cursor. `null`/omitted = no search.
     */
    q?: string | null;
    /**
     * Anchor for "current month" used by the volume-trend bucket.
     * Injectable for tests; defaults to `new Date()` in production so
     * controllers don't have to thread the clock through.
     */
    now?: Date;
  }): Promise<SenderListRow[]> {
    const { mailboxAccountId, category, isProtected, cursor, limit } = args;
    const sort: SenderListSort = args.sort ?? 'total';
    if (!SUPPORTED_SORTS.has(sort)) {
      throw new BadRequestException(`Unsupported sort: ${sort}`);
    }
    const direction: SenderListDirection = args.direction ?? DEFAULT_DIRECTION_BY_SORT[sort];
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
    // `numeric(3,2)` confidence of that same most-recent decision —
    // surfaced on the list `lastReview` so the FE confidence gate
    // (`uplift-d/intent.ts`) suppresses low-confidence recommendations.
    const lastDecisionConfidenceSql = sql<string | null>`(
      SELECT ${triageDecisions.confidence}
      FROM ${triageDecisions}
      WHERE ${triageDecisions.mailboxAccountId} = ${outerMailboxId}
        AND ${triageDecisions.senderKey} = ${outerSenderKey}
      ORDER BY ${triageDecisions.producedAt} DESC
      LIMIT 1
    )`;

    // Keyset predicate — `(sort_col, id) < (cursor.key, cursor.id)`
    // (or `>` for ASC) expressed as the equivalent OR-chain so PG can
    // use the per-column composite index. The active sort's predicate
    // + the `ORDER BY` clause below are built together so direction
    // never drifts between them.
    const conditions = [eq(senders.mailboxAccountId, mailboxAccountId)];
    if (category) {
      conditions.push(eq(senders.gmailCategory, category));
    }
    if (isProtected === true) {
      // Standing-protected filter — the same `sender_policies` join below
      // exposes `is_protected`, so the predicate rides the existing left
      // join (NULL for senders without a policy row → excluded, which is
      // the correct default for a "show only protected" surface).
      conditions.push(eq(senderPolicies.isProtected, true));
    }
    const cursorPredicate = cursor ? buildCursorPredicate(sort, direction, cursor) : null;
    if (cursorPredicate) {
      conditions.push(cursorPredicate);
    }
    const searchCondition = buildSenderSearchCondition(args.q);
    if (searchCondition) {
      conditions.push(searchCondition);
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
        totalReceived: senders.totalReceived,
        unsubscribeMethod: senders.unsubscribeMethod,
        latestVolume: latestVolumeSql,
        latestReadCount: latestReadCountSql,
        currentMonthVolume: currentMonthVolumeSql,
        priorAvgVolume: priorAvgVolumeSql,
        historyMonthCount: historyMonthCountSql,
        lastDecisionAt: lastDecisionAtSql,
        lastDecisionVerdict: lastDecisionVerdictSql,
        lastDecisionGeneratedBy: lastDecisionGeneratedBySql,
        lastDecisionConfidence: lastDecisionConfidenceSql,
        // Standing-policy flags — left-joined so a sender with no
        // `sender_policies` row reads null (engine default). Mirrors the
        // join in `getSenderDetail`; `sender_policies` is unique on
        // `(mailbox_account_id, sender_key)` so no row multiplication.
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
      .where(and(...conditions))
      // ORDER BY matches the cursor predicate + per-column index
      // direction (see `buildSortOrderBy`). The id tie-breaker rides
      // the same direction so a page boundary at equal `sortVal`
      // tracks the index, not a sort-engine fallback.
      .orderBy(...buildSortOrderBy(sort, direction))
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
      // `total_received` is `bigint` in the column but Drizzle's
      // `mode: 'number'` coerces to a JS number at the boundary. We
      // assert the runtime type so a future driver swap that hands
      // back a string surfaces here as a clear contract violation
      // rather than a misrendered "0" downstream.
      totalReceived: ensureSafeIntegerNumber(row.totalReceived, 'senders.total_received'),
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
        row.lastDecisionConfidence,
      ),
      protectionFlags: {
        isVip: row.isVip ?? false,
        isProtected: row.isProtected ?? false,
        protectionReason: row.protectionReason ?? null,
        protectionSetAt: row.protectionSetAt ? row.protectionSetAt.toISOString() : null,
      },
    }));
  }

  /**
   * Compute the `meta.query` block for `GET /api/senders` (senders
   * list contract). Returned on every page; clients should treat
   * **page 1's value as authoritative** through a scroll.
   *
   * - `totalMatching`  — `COUNT(*)` over the active filter (mailbox +
   *                      `category` + `isProtected`); NOT cursor-scoped.
   *                      Drives "X of N senders" copy + the bulk
   *                      select-all banner.
   * - `globalMaxTotal` — `MAX(total_received)` for the mailbox,
   *                      UNFILTERED (per contract). Magnitude-bar
   *                      denominator — a filtered view must NOT rescale
   *                      to its own max, so bars stay comparable.
   * - `asOf`           — server time at compute (observability).
   *
   * Two separate SELECTs because the predicates differ: `totalMatching`
   * honors filters; `globalMaxTotal` does not. Each is a single
   * indexed scan; cheaper than a CTE that joins them.
   */
  async getSenderListQueryMeta(args: {
    mailboxAccountId: string;
    category: GmailCategory | null;
    isProtected?: boolean | null;
    /** Search term (#145) — `totalMatching` must reflect the same filter
     *  the list scan uses, so "All N" counts the search hits, not the
     *  whole mailbox. */
    q?: string | null;
  }): Promise<SenderListQueryMeta> {
    const { mailboxAccountId, category, isProtected } = args;

    const totalMatchingConditions = [eq(senders.mailboxAccountId, mailboxAccountId)];
    if (category) {
      totalMatchingConditions.push(eq(senders.gmailCategory, category));
    }
    if (isProtected === true) {
      totalMatchingConditions.push(eq(senderPolicies.isProtected, true));
    }
    const searchCondition = buildSenderSearchCondition(args.q);
    if (searchCondition) {
      totalMatchingConditions.push(searchCondition);
    }

    // `totalMatching` mirrors the list query's filter chain. Joins the
    // same `sender_policies` so the `isProtected` predicate resolves
    // against the same nullable column the list scan sees.
    const totalMatchingQuery = this.db
      .select({ count: sql<string | number>`COUNT(*)::bigint` })
      .from(senders)
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, senders.mailboxAccountId),
          eq(senderPolicies.senderKey, senders.senderKey),
        ),
      )
      .where(and(...totalMatchingConditions));

    // `globalMaxTotal` is mailbox-wide unfiltered — the magnitude-bar
    // denominator must stay constant across filter changes (a
    // filtered view does NOT rescale to its own max).
    const globalMaxQuery = this.db
      .select({
        max: sql<string | number>`COALESCE(MAX(${senders.totalReceived}), 0)::bigint`,
      })
      .from(senders)
      .where(eq(senders.mailboxAccountId, mailboxAccountId));

    const [totalRow, maxRow] = await Promise.all([totalMatchingQuery, globalMaxQuery]);
    const totalMatching = ensureSafeIntegerNumber(totalRow[0]?.count ?? 0, 'totalMatching');
    const globalMaxTotal = ensureSafeIntegerNumber(maxRow[0]?.max ?? 0, 'globalMaxTotal');

    return {
      totalMatching,
      globalMaxTotal,
      asOf: (args as { now?: Date }).now?.toISOString() ?? new Date().toISOString(),
    };
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
    const lastDecisionConfidenceSql = sql<string | null>`(
      SELECT ${triageDecisions.confidence}
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
        totalReceived: senders.totalReceived,
        unsubscribeMethod: senders.unsubscribeMethod,
        latestVolume: latestVolumeSql,
        latestReadCount: latestReadCountSql,
        currentMonthVolume: currentMonthVolumeSql,
        priorAvgVolume: priorAvgVolumeSql,
        historyMonthCount: historyMonthCountSql,
        lastDecisionAt: lastDecisionAtSql,
        lastDecisionVerdict: lastDecisionVerdictSql,
        lastDecisionGeneratedBy: lastDecisionGeneratedBySql,
        lastDecisionConfidence: lastDecisionConfidenceSql,
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
      totalReceived: ensureSafeIntegerNumber(row.totalReceived, 'senders.total_received'),
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
        row.lastDecisionConfidence,
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

    const SLICE_MAX = 24;
    const SLICE_MIN = 3;

    // Per-slice queries (PR #115 review P1 — limit-after-rank).
    //
    // Previous attempts loaded every sender with 6 correlated subqueries
    // and ranked / capped in TypeScript. That had two flaws:
    //   (a) Unbounded outer scan — fine up to ~7k senders but linear
    //       with the mailbox.
    //   (b) Worse, the v2 patch that added `LIMIT 1500` to the outer
    //       SELECT truncated the candidate set BEFORE slice-specific
    //       ranking, so mailboxes with more than 1500 qualifying rows
    //       would surface an arbitrary subset and miss the top-volume /
    //       highest-ratio / sortest-quiet senders.
    //
    // Each slice now runs as its own SELECT with:
    //   - SQL-side predicates so only candidates that actually belong
    //     to the slice are evaluated,
    //   - `LATERAL` joins for "latest row per (mailbox, sender)" reads
    //     (replaces the correlated subquery pattern; same indexes serve
    //     it),
    //   - SQL-side `ORDER BY` matching the slice's ranking rule, and
    //   - `LIMIT ${SLICE_MAX}` AFTER ranking — D48's top-N cap is
    //     enforced at the DB boundary so the right rows always win.
    //
    // `COUNT(*) OVER ()` gives the true qualifying-cardinality on
    // every row of the limited result; the response uses it for
    // `totalCount` so callers know "out of N possible, we surfaced 24".
    //
    // Tenant boundary (MISTAKES.md 2026-05-23): every LATERAL body
    // joins on `s.mailbox_account_id = senders.mailbox_account_id`
    // via the outer `s` alias, so the (mailbox_account_id, sender_key)
    // index hits cleanly and there is no risk of a tautology.
    type SliceRow = {
      id: string;
      sender_key: string;
      display_name: string;
      email: string;
      domain: string;
      first_seen_at: Date;
      last_seen_at: Date;
      latest_volume: number | null;
      latest_read_count: number | null;
      total_count: number | string;
    };

    const longQuietCutoffIso = longQuietCutoff.toISOString();
    const sixMonthsAgoIso = sixMonthsAgo.toISOString();
    const nowIso = now.toISOString();

    const [highConfidenceRes, spikeRes, quietRes] = await Promise.all([
      // High-confidence slice (D48 §1): latest triage decision says
      // archive/unsubscribe with confidence > 0.85, ranked by latest
      // monthly volume desc (noisiest first).
      this.db.execute<SliceRow>(sql`
        SELECT
          s.id, s.sender_key, s.display_name, s.email, s.domain,
          s.first_seen_at, s.last_seen_at,
          latest_ts.volume AS latest_volume,
          latest_ts.read_count AS latest_read_count,
          COUNT(*) OVER () AS total_count
        FROM ${senders} s
        INNER JOIN LATERAL (
          SELECT verdict, confidence
          FROM ${triageDecisions}
          WHERE mailbox_account_id = s.mailbox_account_id
            AND sender_key = s.sender_key
          ORDER BY produced_at DESC
          LIMIT 1
        ) latest_td ON latest_td.verdict IN ('archive', 'unsubscribe')
                  AND latest_td.confidence > 0.85
        LEFT JOIN LATERAL (
          SELECT volume, read_count
          FROM ${senderTimeseries}
          WHERE mailbox_account_id = s.mailbox_account_id
            AND sender_key = s.sender_key
          ORDER BY year_month DESC
          LIMIT 1
        ) latest_ts ON true
        WHERE s.mailbox_account_id = ${mailboxAccountId}
        ORDER BY latest_ts.volume DESC NULLS LAST, s.sender_key
        LIMIT ${SLICE_MAX}
      `),

      // Spike slice (D48 §2): current-month volume ≥ 3× prior-3-month
      // average AND a non-trivial baseline (prior_avg ≥ 1) so a single
      // message doesn't surface as a "spike". Ranked by ratio desc.
      this.db.execute<SliceRow>(sql`
        SELECT
          s.id, s.sender_key, s.display_name, s.email, s.domain,
          s.first_seen_at, s.last_seen_at,
          latest_ts.volume AS latest_volume,
          latest_ts.read_count AS latest_read_count,
          COUNT(*) OVER () AS total_count
        FROM ${senders} s
        INNER JOIN LATERAL (
          SELECT volume
          FROM ${senderTimeseries}
          WHERE mailbox_account_id = s.mailbox_account_id
            AND sender_key = s.sender_key
            AND year_month = ${currentMonthIso}
        ) current_ts ON true
        INNER JOIN LATERAL (
          SELECT AVG(volume)::float AS avg_vol
          FROM ${senderTimeseries}
          WHERE mailbox_account_id = s.mailbox_account_id
            AND sender_key = s.sender_key
            AND year_month >= ${priorWindowStartIso}
            AND year_month < ${currentMonthIso}
        ) prior_ts ON prior_ts.avg_vol >= 1
        LEFT JOIN LATERAL (
          SELECT volume, read_count
          FROM ${senderTimeseries}
          WHERE mailbox_account_id = s.mailbox_account_id
            AND sender_key = s.sender_key
          ORDER BY year_month DESC
          LIMIT 1
        ) latest_ts ON true
        WHERE s.mailbox_account_id = ${mailboxAccountId}
          AND current_ts.volume >= 3 * prior_ts.avg_vol
        ORDER BY (current_ts.volume::float / prior_ts.avg_vol) DESC, s.sender_key
        LIMIT ${SLICE_MAX}
      `),

      // Quiet slice (D48 §3): last_seen ≥ 30d ago AND first_seen ≥ 6mo
      // ago (D48 — "no surprises"), latest volume > 0, read_rate < 30%.
      // Ranked by monthly_volume × months_active desc (target senders
      // that were noisy when active).
      this.db.execute<SliceRow>(sql`
        SELECT
          s.id, s.sender_key, s.display_name, s.email, s.domain,
          s.first_seen_at, s.last_seen_at,
          latest_ts.volume AS latest_volume,
          latest_ts.read_count AS latest_read_count,
          COUNT(*) OVER () AS total_count
        FROM ${senders} s
        INNER JOIN LATERAL (
          SELECT volume, read_count
          FROM ${senderTimeseries}
          WHERE mailbox_account_id = s.mailbox_account_id
            AND sender_key = s.sender_key
          ORDER BY year_month DESC
          LIMIT 1
        ) latest_ts ON latest_ts.volume > 0
        WHERE s.mailbox_account_id = ${mailboxAccountId}
          AND s.last_seen_at < ${longQuietCutoffIso}
          AND s.first_seen_at < ${sixMonthsAgoIso}
          AND (latest_ts.read_count::float / latest_ts.volume) < 0.30
        ORDER BY (latest_ts.volume::float
                   * (EXTRACT(EPOCH FROM (${nowIso}::timestamptz - s.first_seen_at)) / 86400 / 30)) DESC,
                 s.sender_key
        LIMIT ${SLICE_MAX}
      `),
    ]);

    // postgres-js + PGlite both return execute() results with a
    // `.rows` array on the result envelope. Drizzle types the call as
    // an array-like; cast through the envelope to read the rows.
    const extractRows = (res: unknown): SliceRow[] =>
      ((res as { rows?: SliceRow[] }).rows ?? (res as SliceRow[])) as SliceRow[];

    const highConfidence = extractRows(highConfidenceRes);
    const spike = extractRows(spikeRes);
    const quiet = extractRows(quietRes);

    // Maps a wire-shape SliceRow (snake_case from raw SQL) into the
    // camelCase shape the response-build loop expects. Keeps the
    // existing sparkline + slice-render code unchanged.
    type SliceMember = {
      id: string;
      senderKey: string;
      displayName: string;
      email: string;
      domain: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
      latestVolume: number | null;
      latestReadCount: number | null;
    };
    const toMember = (r: SliceRow): SliceMember => ({
      id: r.id,
      senderKey: r.sender_key,
      displayName: r.display_name,
      email: r.email,
      domain: r.domain,
      firstSeenAt:
        r.first_seen_at instanceof Date ? r.first_seen_at : new Date(r.first_seen_at as string),
      lastSeenAt:
        r.last_seen_at instanceof Date ? r.last_seen_at : new Date(r.last_seen_at as string),
      latestVolume: r.latest_volume,
      latestReadCount: r.latest_read_count,
    });

    // Capture per-slice true totalCount from the window function. The
    // value is identical across every row of a slice; reading the
    // first row is sufficient. Empty slice ⇒ 0.
    const totalCounts = {
      high_confidence: highConfidence.length > 0 ? Number(highConfidence[0]!.total_count ?? 0) : 0,
      spike: spike.length > 0 ? Number(spike[0]!.total_count ?? 0) : 0,
      quiet: quiet.length > 0 ? Number(quiet[0]!.total_count ?? 0) : 0,
    } as const;

    const sliceMembers = {
      high_confidence: highConfidence.map(toMember),
      spike: spike.map(toMember),
      quiet: quiet.map(toMember),
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
      // D48 — slices with fewer than 3 qualifying senders are omitted
      // from the response. Cardinality check is against the full
      // qualifying set (from the COUNT(*) OVER () window function), not
      // the LIMIT-capped page — otherwise a 24-member slice followed by
      // 5 more eligibles would render fine while a slice that's already
      // surfaced 24 of 24 qualifying would be measured the same. The
      // distinction only matters at the 24-row boundary.
      const trueTotal = totalCounts[kind];
      if (trueTotal < SLICE_MIN) continue;
      // `members` is already SQL-capped at SLICE_MAX and ranked at SQL
      // level — no further slicing needed.
      const rows: WeeklyHeroSenderRow[] = members.map((m) => {
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
        totalCount: trueTotal,
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
  confidence: number | string | null,
): LastReview | null {
  if (at === null || verdict === null || generatedBy === null || confidence === null) {
    return null;
  }
  // Scalar correlated subqueries on a `timestamptz` column come back
  // as strings from postgres-js + PGlite (no Drizzle column-type
  // coercion in scalar `sql<>` contexts), even though the TS template
  // type promises `Date`. Normalise via `new Date(...)` so a future
  // driver change that DOES coerce to `Date` doesn't break us either.
  const asDate = at instanceof Date ? at : new Date(at);
  // `confidence` is `numeric(3,2)` — postgres-js + PGlite hand it back
  // as a string. Coerce at the boundary so the wire is a plain number
  // (matching the FE `SenderLastReview.confidence`). A decision row
  // always has a non-null confidence, so a non-finite parse here is a
  // contract violation — drop to null rather than ship NaN, so the FE
  // confidence gate defaults to its safe full-confidence fallback.
  const confidenceNum = typeof confidence === 'number' ? confidence : Number.parseFloat(confidence);
  if (!Number.isFinite(confidenceNum)) {
    return null;
  }
  return {
    at: asDate.toISOString(),
    verdict,
    generatedBy,
    confidence: confidenceNum,
  };
}

/**
 * Build the `ORDER BY` clause for one of the Slice 1 sortable columns.
 * Direction applies to BOTH the sort column AND the `id` tie-breaker
 * so the index walk and the cursor predicate move in lockstep.
 *
 * Index alignment per ADR-0014 + senders list contract:
 *   - `total`       → `(mailbox, total_received DESC, id DESC)`
 *   - `last_seen`   → no explicit composite today; planner falls back
 *                     to the mailbox-equality prefix + sort on heap.
 *                     Cheap at <5k senders; sister index documented as
 *                     a per-slice add when traffic warrants it.
 *   - `first_seen`  → same fallback as `last_seen`.
 *   - `name`        → same fallback; PG sorts `text` lexicographically.
 *                     For very large mailboxes a `(mailbox, lower(name))`
 *                     covering index becomes worth adding.
 */
function buildSortOrderBy(sort: SenderListSort, direction: SenderListDirection): SQL[] {
  const orient = direction === 'asc' ? asc : desc;
  const column = (() => {
    switch (sort) {
      case 'total':
        return senders.totalReceived;
      case 'last_seen':
        return senders.lastSeenAt;
      case 'first_seen':
        return senders.firstSeenAt;
      case 'name':
        return senders.displayName;
      default:
        // `read` and `recommended` are screened off by SUPPORTED_SORTS
        // upstream; throwing here is the defense-in-depth.
        throw new Error(`Unsupported sort in buildSortOrderBy: ${sort as string}`);
    }
  })();
  return [orient(column) as SQL, orient(senders.id) as SQL];
}

/**
 * Build the keyset cursor predicate for one of the Slice 1 sortable
 * columns. The shape is the canonical OR-chain:
 *
 *   (sort_col, id) <op> (cursor.sortVal, cursor.id)
 *
 * which Postgres recognises as an index-aligned keyset scan when
 * expressed as `sort_col <op> ? OR (sort_col = ? AND id <op> ?)`.
 *
 * `direction` picks the comparison operator (DESC → `<`, ASC → `>`).
 * The cursor.key is the column's value at the boundary, parsed per
 * sort:
 *   - `total`       → number (decimal string accepted, asserted safe)
 *   - `last_seen`   → ISO-8601 Date string
 *   - `first_seen`  → ISO-8601 Date string
 *   - `name`        → opaque string (PG sorts lexicographically)
 */
function buildCursorPredicate(
  sort: SenderListSort,
  direction: SenderListDirection,
  cursor: SenderListCursor,
): SQL {
  const op = direction === 'asc' ? gt : lt;
  switch (sort) {
    case 'total': {
      const sortVal = Number.parseInt(cursor.key, 10);
      if (!Number.isFinite(sortVal)) {
        throw new BadRequestException('Invalid cursor: total must be an integer.');
      }
      return or(
        op(senders.totalReceived, sortVal),
        and(eq(senders.totalReceived, sortVal), op(senders.id, cursor.id)),
      )!;
    }
    case 'last_seen': {
      const sortVal = new Date(cursor.key);
      if (Number.isNaN(sortVal.getTime())) {
        throw new BadRequestException('Invalid cursor: last_seen must be an ISO-8601 date.');
      }
      return or(
        op(senders.lastSeenAt, sortVal),
        and(eq(senders.lastSeenAt, sortVal), op(senders.id, cursor.id)),
      )!;
    }
    case 'first_seen': {
      const sortVal = new Date(cursor.key);
      if (Number.isNaN(sortVal.getTime())) {
        throw new BadRequestException('Invalid cursor: first_seen must be an ISO-8601 date.');
      }
      return or(
        op(senders.firstSeenAt, sortVal),
        and(eq(senders.firstSeenAt, sortVal), op(senders.id, cursor.id)),
      )!;
    }
    case 'name': {
      return or(
        op(senders.displayName, cursor.key),
        and(eq(senders.displayName, cursor.key), op(senders.id, cursor.id)),
      )!;
    }
    default:
      throw new Error(`Unsupported sort in buildCursorPredicate: ${sort as string}`);
  }
}

/**
 * Coerce a `bigint`-shaped scalar (Drizzle's `mode: 'number'` should
 * already coerce, but PGlite + raw `sql<bigint>` paths can hand back
 * strings) into a JS `number`, asserting safe-integer bounds.
 *
 * ADR-0014: `total_received` is bounded far below
 * `Number.MAX_SAFE_INTEGER`; the assertion makes a violation explicit
 * at the wire boundary rather than allowing precision loss to ripple
 * into the FE. `label` is included in the error so a future regression
 * shows up grep-able at the call site.
 */
function ensureSafeIntegerNumber(value: string | number, label: string): number {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) {
    throw new InternalServerErrorException(`${label} out of safe-integer range: ${value}`);
  }
  return n;
}
