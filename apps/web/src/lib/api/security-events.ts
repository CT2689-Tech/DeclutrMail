/**
 * Security events API — typed fetcher for the D181 operator read surface.
 *
 * Wire shape mirrors the BE controller in
 * `apps/api/src/security-events/security-events.controller.ts` and the
 * read service's `SecurityEventRow`. Any drift between BE and these
 * declarations is a contract violation the D202 envelope surfaces at
 * compile time.
 *
 * Auth gating: the BE route is behind `JwtGuard` + `AdminAllowlistGuard`.
 * Non-allowlisted users receive 404 (intentional — see
 * `admin-allowlist.guard.ts` for the rationale). The FE treats a 404
 * here as "you are not an admin" and renders the standard not-found
 * surface; never reveals the route's existence to a non-admin.
 *
 * Privacy (D7, D228): payloads on the wire are the closed-enum
 * reasons / discriminators the producers emit (`provider`, `reason`,
 * `bucket`, `operation`, `keyResource`, …). Never message bodies,
 * snippets, attachments, or non-allowlisted headers.
 */

import type { PaginatedEnvelope } from '@declutrmail/shared/contracts';

import { apiGet } from './client';

/** Closed severity enum — matches BE `SecurityEventSeverity`. */
export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

/** One audit row on `GET /api/security-events`. */
export interface SecurityEventWire {
  id: string;
  /** Machine-readable kind (e.g. `login.failure`, `rate_limit.breach`). */
  eventType: string;
  severity: SecurityEventSeverity;
  /** ISO-8601 — when the event was recorded. */
  occurredAt: string;
  workspaceId: string | null;
  userId: string | null;
  /** INET column on the BE — string here. */
  sourceIp: string | null;
  userAgent: string | null;
  /** Closed-enum payload from the producer. Always a JSON object or null. */
  payload: Record<string, unknown> | null;
}

/** Query inputs for the list endpoint. All optional. */
export interface ListSecurityEventsInput {
  severity?: SecurityEventSeverity;
  eventType?: string;
  /** ISO-8601 inclusive bound on `occurred_at`. */
  from?: string;
  /** ISO-8601 inclusive bound on `occurred_at`. */
  to?: string;
  /** Opaque continuation cursor from a prior page. */
  cursor?: string;
  /** Page size — BE clamps to [1, 200], default 50. */
  limit?: number;
}

/**
 * `GET /api/security-events` — D202 paginated envelope. The BE
 * validates inputs (closed severity, ISO-8601 bounds) and 400s on
 * malformed values; this client passes through whatever the caller
 * sends and surfaces the 400 as an `ApiError`.
 */
export function fetchSecurityEvents(
  input: ListSecurityEventsInput,
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<SecurityEventWire>> {
  const query: Record<string, string | number | undefined> = {
    severity: input.severity,
    event_type: input.eventType,
    from: input.from,
    to: input.to,
    cursor: input.cursor,
    limit: input.limit,
  };
  return apiGet<SecurityEventWire[]>('/api/security-events', {
    query,
    ...(signal ? { signal } : {}),
  }) as Promise<PaginatedEnvelope<SecurityEventWire>>;
}
