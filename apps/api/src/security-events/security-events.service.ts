import { Inject, Injectable, Logger } from '@nestjs/common';

import { securityEvents } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/** D181 severity — the closed set the `security_events` CHECK enforces. */
export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

/** Structured Cloud Logging subjects. Other audit types stay in Postgres only. */
const SECURITY_LOG_EVENTS = new Set(['oauth.start', 'login.failure']);

/**
 * Closed callback reasons safe to put on a log line. Anything else,
 * including free text and addresses, becomes `other`.
 */
const SECURITY_LOG_REASONS = new Set([
  'missing_state_cookie',
  'invalid_state_cookie',
  'invalid_state',
  'missing_code',
  'token_exchange_failed',
  'reconnect_failed',
  'reconnect_target_invalid',
  'reconnect_account_mismatch',
  'reconnect_cancelled',
  'reconnect_gmail_scope_missing',
  'consent_cancelled',
  'consent_failed',
  'orchestrator_failed',
  'sign_in_failed',
  'connect_session_invalid',
  'connect_failed',
  'gmail_scope_missing',
  'MAILBOX_OWNED_BY_OTHER_WORKSPACE',
  'INBOX_LIMIT_REACHED',
]);

function securityLogLevel(severity: SecurityEventSeverity): 'info' | 'warning' | 'error' {
  switch (severity) {
    case 'info':
      return 'info';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'error';
    default: {
      const unreachable: never = severity;
      return unreachable;
    }
  }
}

function securityLogReason(payload: Record<string, unknown> | null | undefined): string {
  const reason = payload?.reason;
  return typeof reason === 'string' && SECURITY_LOG_REASONS.has(reason) ? reason : 'other';
}

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
      return;
    }
    this.emitSecurityLog(input);
  }

  /** Count-only log after a durable insert. No address, account, or request identity. */
  private emitSecurityLog(input: RecordSecurityEventInput): void {
    if (!SECURITY_LOG_EVENTS.has(input.eventType)) return;
    try {
      console.log(
        JSON.stringify({
          level: securityLogLevel(input.severity),
          kind: 'security_event',
          eventType: input.eventType,
          reason: securityLogReason(input.payload),
        }),
      );
    } catch {
      /* A log sink failure must not break the request that already persisted the audit row. */
    }
  }
}
