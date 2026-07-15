// apps/api/src/activity/activity.controller.ts — HTTP surface for the
// Activity feed (D55-D60, tracer-bullet).
//
// Thin per D201/D204: validates input, delegates to
// `ActivityReadService`, assembles the combined D202 envelope (data
// + pagination + activity-specific meta).
//
// AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` + `CsrfGuard`.

import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  type Envelope,
  type PaginationMeta,
  clampLimit,
  decodeCursor,
  encodeCursor,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { ACTIVITY_LIMIT, ActivityReadService } from './activity.read-service.js';
import { ActivitySupportBundleService } from './activity-support-bundle.service.js';
import type {
  ActivityListMeta,
  ActivityRow,
  ActivityReviewOutcome,
  ActivitySourceFilter,
  ActivitySummary,
  ActivityVerbFilter,
  ActivityWindow,
  ActivityWeeklyReview,
} from './activity.types.js';

/** D55 — accepted window values; everything else collapses to default. */
const ALLOWED_WINDOWS: ReadonlySet<ActivityWindow> = new Set(['7d', '30d', '90d', 'all']);
const DEFAULT_WINDOW: ActivityWindow = '30d';

/**
 * D56 — accepted source chip values. Tracer-bullet exposes the 4
 * `activity_source` enum values + `'all'`; "Senders" + "Brief" chips
 * (which would need an enum extension) are intentionally omitted.
 */
const ALLOWED_SOURCES: ReadonlySet<ActivitySourceFilter> = new Set([
  'all',
  'triage',
  'manual',
  'autopilot',
  'screener',
]);

/**
 * Valid verb filter values — every `activity_log.action` enum value
 * the Activity feed surfaces. Multi-select on the wire.
 */
const ALLOWED_VERBS: ReadonlySet<ActivityVerbFilter> = new Set([
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
  'followup-dismiss',
]);

const ALLOWED_OUTCOMES: ReadonlySet<ActivityReviewOutcome> = new Set([
  'completed',
  'skipped',
  'failed',
  'recovered',
  'protected',
]);

/**
 * Hard cap on the sender-search input length — defensive guard against
 * a runaway query and against a user pasting a 100KB string into the
 * search box. 200 chars covers any sane sender name + email + slack.
 */
const SENDER_QUERY_MAX_LENGTH = 200;

/**
 * Combined activity envelope. Carries:
 *   - the standard D202 `pagination` block, AND
 *   - the activity-specific `stats` / `window` / `source` echo so the FE
 *     can drive the D59 stats header + chips without a second round-trip.
 */
export type ActivityListEnvelope = Envelope<
  ActivityRow[],
  { pagination: PaginationMeta } & ActivityListMeta
>;

interface Principal {
  userId: string;
  workspaceId: string;
}

@Controller('activity')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
export class ActivityController {
  constructor(
    private readonly reads: ActivityReadService,
    private readonly bundles: ActivitySupportBundleService,
  ) {}

  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 300 })
  async exportBundle(
    @CurrentUser() principal: Principal,
    @CurrentMailbox() mailbox: { id: string },
    @Query('window') rawWindow: string | undefined,
    @Query('source') rawSource: string | undefined,
    @Query('verb') rawVerb: string | string[] | undefined,
    @Query('sender_q') rawSenderQuery: string | undefined,
    @Query('date_from') rawDateFrom: string | undefined,
    @Query('date_to') rawDateTo: string | undefined,
    @Query('sender_addresses') rawSenderAddresses: string | undefined,
    @Query('include_technical') rawIncludeTechnical: string | undefined,
    @Query('outcome') rawOutcome: string | string[] | undefined,
  ): Promise<StreamableFile> {
    const filters = resolveActivityFilters({
      rawWindow,
      rawSource,
      rawVerb,
      rawSenderQuery,
      rawDateFrom,
      rawDateTo,
      rawOutcome,
    });
    const stream = await this.bundles.createBundle({
      workspaceId: principal.workspaceId,
      mailboxAccountId: mailbox.id,
      filters: {
        window: filters.window,
        source: filters.source,
        verbs: filters.verbs,
        senderQuery: filters.senderQuery,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        outcomes: filters.outcomes,
      },
      includeFullSenderAddresses: resolveSenderAddressMode(rawSenderAddresses),
      includeTechnicalDetails: resolveTechnicalDetails(rawIncludeTechnical),
    });
    const date = new Date().toISOString().slice(0, 10);
    return new StreamableFile(stream, {
      type: 'application/zip',
      disposition: `attachment; filename="declutrmail-activity-support-${date}.zip"`,
    });
  }

  /**
   * GET /api/activity — paginated activity feed for the caller's
   * mailbox, newest first.
   *
   * Query params:
   *   - `window` — `'7d' | '30d' | '90d' | 'all'`. Default `'30d'` (D55).
   *   - `source` — `'all' | 'triage' | 'manual' | 'autopilot' | 'screener'`.
   *                Default `'all'`. (D56 partial — see read-service notes.)
   *   - `limit`  — page size (default 25, max 100).
   *   - `cursor` — opaque continuation token from a prior page's
   *                `meta.pagination.nextCursor`.
   *
   * Returns ActivityRow[] + combined meta (pagination + stats + echo).
   * Stats are computed independent of the source filter so the D59
   * header stays stable as the user switches chips.
   */
  @Get()
  @RateLimit('triage-load')
  async list(
    @CurrentUser() principal: Principal,
    @CurrentMailbox() mailbox: { id: string },
    @Query('window') rawWindow: string | undefined,
    @Query('source') rawSource: string | undefined,
    @Query('verb') rawVerb: string | string[] | undefined,
    @Query('sender_q') rawSenderQuery: string | undefined,
    @Query('date_from') rawDateFrom: string | undefined,
    @Query('date_to') rawDateTo: string | undefined,
    @Query('outcome') rawOutcome: string | string[] | undefined,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<ActivityListEnvelope> {
    const accountId = mailbox.id;
    const filters = resolveActivityFilters({
      rawWindow,
      rawSource,
      rawVerb,
      rawSenderQuery,
      rawDateFrom,
      rawDateTo,
      rawOutcome,
    });
    const limit = clampLimit(rawLimit, ACTIVITY_LIMIT);

    const cursorRaw = decodeCursor(rawCursor);
    if (rawCursor && cursorRaw === null) {
      throw new BadRequestException('Invalid cursor.');
    }
    const cursor = cursorRaw ? { occurredAt: new Date(cursorRaw.key), id: cursorRaw.id } : null;
    if (cursor && Number.isNaN(cursor.occurredAt.getTime())) {
      throw new BadRequestException('Invalid cursor.');
    }

    const { rows, stats, allTimeStats } = await this.reads.listActivity({
      mailboxAccountId: accountId,
      userId: principal.userId,
      window: filters.window,
      source: filters.source,
      verbs: filters.verbs,
      senderQuery: filters.senderQuery,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      outcomes: filters.outcomes,
      cursor,
      limit,
      nowMs: Date.now(),
    });

    const { page, nextCursor } = takePage(rows, limit, (row) =>
      encodeCursor({ key: row.occurredAt, id: row.id }),
    );

    const pagination: PaginationMeta = {
      nextCursor,
      hasMore: nextCursor !== null,
      limit,
    };
    // `meta.pagination.nextCursor` is the canonical D202 cursor field
    // (matches senders + undo + triage). A previous revision also spread
    // `nextCursor` at the meta top level — architecture-guardian flagged
    // the duplicate as a contract drift surface (a client reading from
    // one and another reading from the other agreed by coincidence).
    return {
      data: page,
      meta: {
        pagination,
        stats,
        allTimeStats,
        window: filters.window,
        source: filters.sourceFilter,
        verbs: filters.verbs,
        senderQuery: filters.senderQuery,
        dateFrom: filters.dateFrom ? filters.dateFrom.toISOString() : null,
        dateTo: filters.dateTo ? filters.dateTo.toISOString() : null,
        outcomes: filters.outcomes,
      },
    };
  }

  /** Exact seven-day factual review counts; no estimates or content. */
  @Get('weekly-review')
  @RateLimit('triage-load')
  async weeklyReview(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<ActivityWeeklyReview>> {
    return { data: await this.reads.getWeeklyReview(mailbox.id, Date.now()) };
  }

  /**
   * GET /api/activity/summary — aggregate cleanup totals for the
   * caller's mailbox (DQ16 share-receipt prerequisite).
   *
   * Query params:
   *   - `window` — `'7d' | '30d' | '90d' | 'all'`. Default `'30d'`.
   *     Same D55 vocabulary + fallback behaviour as the list endpoint.
   *
   * Read-only; returns a plain D202 envelope (no meta — the window
   * echo lives in the payload). See {@link ActivitySummary} for field
   * semantics, including the `undoCount` floor caveat.
   */
  @Get('summary')
  @RateLimit('triage-load')
  async summary(
    @CurrentMailbox() mailbox: { id: string },
    @Query('window') rawWindow: string | undefined,
  ): Promise<Envelope<ActivitySummary>> {
    const summary = await this.reads.summarizeActivity({
      mailboxAccountId: mailbox.id,
      window: resolveWindow(rawWindow),
      nowMs: Date.now(),
    });
    return { data: summary };
  }
}

/**
 * `takePage` — duplicate of the senders controller helper, kept local
 * so the activity controller doesn't reach across feature boundaries
 * for a 12-line utility (D204). If a third+ caller appears, promote
 * to `apps/api/src/common/pagination.ts`.
 */
function takePage<T>(
  rows: T[],
  limit: number,
  buildCursor: (row: T) => string,
): { page: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { page: rows, nextCursor: null };
  const page = rows.slice(0, limit);
  const lastVisible = page[page.length - 1]!;
  return { page, nextCursor: buildCursor(lastVisible) };
}

function resolveWindow(raw: string | undefined): ActivityWindow {
  if (raw && ALLOWED_WINDOWS.has(raw as ActivityWindow)) return raw as ActivityWindow;
  return DEFAULT_WINDOW;
}

function resolveSource(raw: string | undefined): ActivitySourceFilter {
  if (raw && ALLOWED_SOURCES.has(raw as ActivitySourceFilter)) {
    return raw as ActivitySourceFilter;
  }
  return 'all';
}

/**
 * Parse the `verb` query param into a deduped list of valid action
 * verbs. Accepts repeat-param (`?verb=archive&verb=delete`) and
 * comma-separated (`?verb=archive,delete`); rejects bogus values
 * silently rather than 400ing — drop-and-continue matches the
 * conservative param handling of `window` / `source`.
 */
function resolveVerbs(raw: string | string[] | undefined): ActivityVerbFilter[] {
  if (raw === undefined) return [];
  const flat = (Array.isArray(raw) ? raw : [raw]).flatMap((entry) => entry.split(','));
  const seen = new Set<ActivityVerbFilter>();
  for (const token of flat) {
    const trimmed = token.trim();
    if (ALLOWED_VERBS.has(trimmed as ActivityVerbFilter)) {
      seen.add(trimmed as ActivityVerbFilter);
    }
  }
  return [...seen];
}

/** Trim + length-cap the sender search term. Empty after trim = no filter. */
function resolveSenderQuery(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().slice(0, SENDER_QUERY_MAX_LENGTH);
  return trimmed;
}

/**
 * Parse an ISO-8601 date string from the wire. Throws 400 on a
 * malformed value (vs window/source which silently fall back) — a
 * date that doesn't parse is a typo the FE should surface, not a
 * silent narrowing.
 */
function resolveDate(raw: string | undefined, paramName: string): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${paramName} must be a valid ISO-8601 date.`);
  }
  return date;
}

function resolveActivityFilters(raw: {
  rawWindow: string | undefined;
  rawSource: string | undefined;
  rawVerb: string | string[] | undefined;
  rawSenderQuery: string | undefined;
  rawDateFrom: string | undefined;
  rawDateTo: string | undefined;
  rawOutcome?: string | string[] | undefined;
}) {
  const window = resolveWindow(raw.rawWindow);
  const sourceFilter = resolveSource(raw.rawSource);
  const dateFrom = resolveDate(raw.rawDateFrom, 'date_from');
  const dateTo = resolveDate(raw.rawDateTo, 'date_to');
  if (dateFrom && dateTo && dateFrom >= dateTo) {
    throw new BadRequestException('date_from must be earlier than date_to.');
  }
  return {
    window,
    sourceFilter,
    source: sourceFilter === 'all' ? null : sourceFilter,
    verbs: resolveVerbs(raw.rawVerb),
    senderQuery: resolveSenderQuery(raw.rawSenderQuery),
    dateFrom,
    dateTo,
    outcomes: resolveOutcomes(raw.rawOutcome),
  };
}

function resolveOutcomes(raw: string | string[] | undefined): ActivityReviewOutcome[] {
  if (raw === undefined) return [];
  const seen = new Set<ActivityReviewOutcome>();
  for (const token of (Array.isArray(raw) ? raw : [raw]).flatMap((entry) => entry.split(','))) {
    const trimmed = token.trim() as ActivityReviewOutcome;
    if (!ALLOWED_OUTCOMES.has(trimmed)) {
      throw new BadRequestException(
        'outcome must be one of: completed, skipped, failed, recovered, protected.',
      );
    }
    seen.add(trimmed);
  }
  return [...seen];
}

function resolveSenderAddressMode(raw: string | undefined): boolean {
  if (raw === undefined || raw === 'masked') return false;
  if (raw === 'full') return true;
  throw new BadRequestException("sender_addresses must be 'masked' or 'full'.");
}

function resolveTechnicalDetails(raw: string | undefined): boolean {
  if (raw === undefined || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new BadRequestException("include_technical must be 'true' or 'false'.");
}
