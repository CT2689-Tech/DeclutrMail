import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';

import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  paginated,
  type PaginatedEnvelope,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { AdminAllowlistGuard } from './admin-allowlist.guard.js';
import {
  type SecurityEventRow,
  SecurityEventsReadService,
} from './security-events-read.service.js';
import type { SecurityEventSeverity } from './security-events.service.js';

/** Closed severity set — repeated here to avoid leaking the type-alias
 * into the runtime validation path. */
const ALLOWED_SEVERITIES: ReadonlySet<SecurityEventSeverity> = new Set([
  'info',
  'warning',
  'critical',
]);

/**
 * Operator-facing read API for the D181 security audit log.
 *
 * Route: `GET /api/security-events`
 *
 * Auth: {@link JwtGuard} (session) → {@link AdminAllowlistGuard} (founder
 * allowlist via `ADMIN_EMAIL_ALLOWLIST` env). Any miss → 404. The
 * route is intentionally indistinguishable from a "not found" response
 * for non-allowlisted users — see `AdminAllowlistGuard` docs for the
 * rationale.
 *
 * Query params (all optional):
 *   - `severity` ∈ {info, warning, critical}
 *   - `event_type` exact match (e.g. `login.failure`)
 *   - `from`, `to` — ISO-8601 timestamps; bounds on `occurred_at`
 *   - `cursor` opaque continuation token from a prior page
 *   - `limit` page size, default 50, clamped [1, 200]
 *
 * Response shape is the D202 paginated envelope:
 *
 *   ```
 *   { data: SecurityEventRow[],
 *     meta: { pagination: { nextCursor, hasMore, limit } } }
 *   ```
 */
@Controller('security-events')
@UseGuards(JwtGuard, AdminAllowlistGuard)
export class SecurityEventsController {
  constructor(private readonly reads: SecurityEventsReadService) {}

  @Get()
  @RateLimit({ bucket: 'triage-load' })
  async list(
    @Query('severity') severity?: string,
    @Query('event_type') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedEnvelope<SecurityEventRow>> {
    const clampedLimit = clampLimit(limit, { def: 50, min: 1, max: 200 });

    // Validate severity at the controller (closed enum) so a typo
    // becomes a 400 here rather than a silent empty result.
    let typedSeverity: SecurityEventSeverity | undefined;
    if (severity !== undefined) {
      if (!ALLOWED_SEVERITIES.has(severity as SecurityEventSeverity)) {
        throw new BadRequestException(
          `severity must be one of: ${Array.from(ALLOWED_SEVERITIES).join(', ')}`,
        );
      }
      typedSeverity = severity as SecurityEventSeverity;
    }

    // Cursor decode failure is intentionally non-fatal: a stale /
    // garbled cursor falls back to a fresh first page rather than
    // 400ing — matches the senders cursor handling and the spirit of
    // pagination tokens being opaque + replaceable.
    const decodedCursor = cursor ? decodeCursor(cursor) : null;

    const fromDate = parseIsoBound('from', from);
    const toDate = parseIsoBound('to', to);

    const rows = await this.reads.list({
      ...(typedSeverity !== undefined ? { severity: typedSeverity } : {}),
      ...(eventType ? { eventType } : {}),
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
      limit: clampedLimit,
      cursor: decodedCursor,
    });

    // Compute nextCursor only when the page filled — a short page
    // means no more rows. The +1 sentinel pattern (over-fetch by one
    // to detect 'has more') is NOT used here; the controller would
    // need to slice the extra row off and the saving (one extra
    // page-load when the table happens to have a multiple-of-limit
    // size) doesn't justify the added complexity for an operator
    // audit view.
    const nextCursor =
      rows.length < clampedLimit
        ? null
        : encodeCursor({
            key: rows[rows.length - 1]!.occurredAt.toISOString(),
            id: rows[rows.length - 1]!.id,
          });

    return paginated({ items: rows, limit: clampedLimit, nextCursor });
  }
}

/**
 * Parse an ISO-8601 timestamp into a `Date`. Returns `undefined` for
 * the unset case; throws 400 for a malformed value. We refuse to
 * silently accept garbage — a misformatted operator query should
 * point at the typo, not at an empty result.
 */
function parseIsoBound(field: 'from' | 'to', raw: string | undefined): Date | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} must be an ISO-8601 timestamp.`);
  }
  return d;
}
