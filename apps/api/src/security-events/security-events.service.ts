import { Inject, Injectable, Logger } from '@nestjs/common';

import { securityEvents } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/** D181 severity — the closed set the `security_events` CHECK enforces. */
export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

/**
 * Input to {@link SecurityEventsService.record}. `eventType` is a
 * machine-readable kind (e.g. `rate_limit.breach`, `login.failure`).
 *
 * Privacy (D7, D228): `payload` is security metadata ONLY — never
 * message bodies, snippets, attachments, or non-allowlisted headers.
 */
export interface RecordSecurityEventInput {
  eventType: string;
  severity: SecurityEventSeverity;
  workspaceId?: string | null;
  userId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * SecurityEventsService (D181) — the single writer for the
 * `security_events` audit log, the security counterpart to the
 * user-facing Activity log (D13).
 *
 * `record` is deliberately failure-tolerant: persisting an audit event
 * must NEVER break the request that triggered it (a failed login that
 * also fails to log should still return 401, not 500). Insert errors are
 * logged and swallowed — the swallow is intentional and logged, not a
 * silent failure.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async record(input: RecordSecurityEventInput): Promise<void> {
    try {
      await this.db.insert(securityEvents).values({
        eventType: input.eventType,
        severity: input.severity,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId ?? null,
        sourceIp: input.sourceIp ?? null,
        userAgent: input.userAgent ?? null,
        payload: input.payload ?? null,
      });
    } catch (err) {
      // Audit-log persistence must not propagate into the triggering
      // request path. Log the failure (so it's visible / alertable) and
      // swallow — never rethrow.
      this.logger.error(
        `security_events insert failed for ${input.eventType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
