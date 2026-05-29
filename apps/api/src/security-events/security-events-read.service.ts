import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';

import { securityEvents } from '@declutrmail/db';
import type { DecodedCursor } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { SecurityEventSeverity } from './security-events.service.js';

/**
 * Filters for {@link SecurityEventsReadService.list}. All optional —
 * absent fields are unrestricted. Validated + normalized at the
 * controller boundary so the read service only sees the canonical
 * shape.
 */
export interface ListSecurityEventsFilters {
  /** Restrict to one severity. */
  severity?: SecurityEventSeverity;
  /** Restrict to one event_type (exact match). */
  eventType?: string;
  /** Lower-bound on `occurred_at` (inclusive). */
  from?: Date;
  /** Upper-bound on `occurred_at` (inclusive). */
  to?: Date;
  /** Page size — the controller clamps to [1, 200] before passing. */
  limit: number;
  /** Continuation cursor from a prior page; `null` for first page. */
  cursor: DecodedCursor | null;
}

/** One row returned by {@link SecurityEventsReadService.list}. */
export interface SecurityEventRow {
  id: string;
  eventType: string;
  severity: SecurityEventSeverity;
  occurredAt: Date;
  workspaceId: string | null;
  userId: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * Read service for the D181 `security_events` audit log. Pairs with
 * the append-only writer ({@link SecurityEventsService}) and the
 * operator-facing controller — separate read / write services so the
 * read path can grow filters + projections without coupling to the
 * writer's narrow `record(...)` surface.
 *
 * Sort: `occurred_at DESC, id DESC` — newest first, with `id` as the
 * tie-breaker (mirrors the schema's `security_events_occurred_at_idx`
 * + standard `(sort_col, id)` keyset pattern, see envelope.ts).
 *
 * Pagination: keyset on the same `(occurred_at, id)` pair. The
 * controller assembles the `nextCursor` from the LAST returned row.
 * Standard +1 sentinel is NOT used here because we already encode
 * the boundary deterministically; `hasMore` is derived from whether
 * the query returned exactly `limit` rows (could be more; the next
 * page will discover).
 */
@Injectable()
export class SecurityEventsReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(filters: ListSecurityEventsFilters): Promise<SecurityEventRow[]> {
    const preds = [];

    if (filters.severity) {
      preds.push(eq(securityEvents.severity, filters.severity));
    }
    if (filters.eventType) {
      preds.push(eq(securityEvents.eventType, filters.eventType));
    }
    if (filters.from) {
      preds.push(gte(securityEvents.occurredAt, filters.from));
    }
    if (filters.to) {
      preds.push(lte(securityEvents.occurredAt, filters.to));
    }
    if (filters.cursor) {
      // Keyset: (occurred_at, id) < (cursor.key, cursor.id) for DESC
      // order. Two-tuple compare in SQL via OR-of-conjunctions —
      // Drizzle does not provide a row-constructor helper, so we
      // build it explicitly. The form is index-friendly because the
      // composite (occurred_at DESC, id DESC) lookup walks the
      // existing `security_events_occurred_at_idx` (which is on
      // occurred_at alone) and then filters by id within the tie —
      // the typical pattern when ties on occurred_at are rare (UUID
      // collisions on a timestamp are vanishingly unlikely).
      const cursorTime = new Date(filters.cursor.key);
      preds.push(
        or(
          lt(securityEvents.occurredAt, cursorTime),
          and(eq(securityEvents.occurredAt, cursorTime), lt(securityEvents.id, filters.cursor.id)),
        )!,
      );
    }

    const where = preds.length > 0 ? and(...preds) : undefined;
    const query = this.db
      .select({
        id: securityEvents.id,
        eventType: securityEvents.eventType,
        severity: securityEvents.severity,
        occurredAt: securityEvents.occurredAt,
        workspaceId: securityEvents.workspaceId,
        userId: securityEvents.userId,
        sourceIp: securityEvents.sourceIp,
        userAgent: securityEvents.userAgent,
        payload: securityEvents.payload,
      })
      .from(securityEvents)
      .orderBy(desc(securityEvents.occurredAt), desc(securityEvents.id))
      .limit(filters.limit);

    const rows = where ? await query.where(where) : await query;

    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      severity: r.severity as SecurityEventSeverity,
      occurredAt: r.occurredAt,
      workspaceId: r.workspaceId,
      userId: r.userId,
      sourceIp: r.sourceIp,
      userAgent: r.userAgent,
      payload: r.payload as Record<string, unknown> | null,
    }));
  }
}
