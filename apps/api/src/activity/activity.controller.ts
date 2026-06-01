// apps/api/src/activity/activity.controller.ts — HTTP surface for the
// Activity feed (D55-D60, tracer-bullet).
//
// Thin per D201/D204: validates input, delegates to
// `ActivityReadService`, assembles the combined D202 envelope (data
// + pagination + activity-specific meta).
//
// AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` + `CsrfGuard`.

import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  type Envelope,
  type PaginationMeta,
  clampLimit,
  decodeCursor,
  encodeCursor,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { ACTIVITY_LIMIT, ActivityReadService } from './activity.read-service.js';
import type {
  ActivityListMeta,
  ActivityRow,
  ActivitySourceFilter,
  ActivityWindow,
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
 * Combined activity envelope. Carries:
 *   - the standard D202 `pagination` block, AND
 *   - the activity-specific `stats` / `window` / `source` echo so the FE
 *     can drive the D59 stats header + chips without a second round-trip.
 */
export type ActivityListEnvelope = Envelope<
  ActivityRow[],
  { pagination: PaginationMeta } & ActivityListMeta
>;

@Controller('activity')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
export class ActivityController {
  constructor(private readonly reads: ActivityReadService) {}

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
    @CurrentMailbox() mailbox: { id: string },
    @Query('window') rawWindow: string | undefined,
    @Query('source') rawSource: string | undefined,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<ActivityListEnvelope> {
    const accountId = mailbox.id;
    const window = resolveWindow(rawWindow);
    const sourceFilter = resolveSource(rawSource);
    const sourceForQuery = sourceFilter === 'all' ? null : sourceFilter;
    const limit = clampLimit(rawLimit, ACTIVITY_LIMIT);

    const cursorRaw = decodeCursor(rawCursor);
    if (rawCursor && cursorRaw === null) {
      throw new BadRequestException('Invalid cursor.');
    }
    const cursor = cursorRaw ? { occurredAt: new Date(cursorRaw.key), id: cursorRaw.id } : null;
    if (cursor && Number.isNaN(cursor.occurredAt.getTime())) {
      throw new BadRequestException('Invalid cursor.');
    }

    const { rows, stats } = await this.reads.listActivity({
      mailboxAccountId: accountId,
      window,
      source: sourceForQuery,
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
    return {
      data: page,
      meta: {
        pagination,
        ...(nextCursor !== null ? { nextCursor } : {}),
        stats,
        window,
        source: sourceFilter,
      },
    };
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
