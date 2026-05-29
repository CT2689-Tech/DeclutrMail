import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Security events log (D181) — distinct from the user-facing Activity
 * log (D13/activity_log).
 *
 * Captures security-relevant events that must NOT appear in the
 * product's Activity surface: login attempts, webhook signature
 * failures, KMS access errors, failed OAuth refreshes, suspicious
 * rate-limit breaches, CSP violation reports, etc. This is an
 * append-mostly audit trail read by operators, not users.
 *
 * Retention vs. account deletion: the FK references use `ON DELETE SET
 * NULL` (not cascade) so a security audit row SURVIVES workspace/user
 * deletion — the de-identified record of "a failed login happened" is
 * exactly what an audit log exists to keep. The `workspace_id` /
 * `user_id` are denormalized convenience joins, nullable by design.
 *
 * Privacy (D7, D228): `payload` is security metadata ONLY — never
 * message bodies, snippets, attachments, or non-allowlisted Gmail
 * headers. `source_ip` + `user_agent` are request metadata, the same
 * class already stored on `active_sessions` (D155).
 *
 * Indexes back the two operator read patterns:
 *   - `(occurred_at DESC)`            — the time-ordered firehose.
 *   - `(severity, occurred_at DESC)`  — "show me criticals, newest first".
 */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Denormalized workspace join; nulled (not deleted) on workspace removal. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /** Subject user when applicable; nulled (not deleted) on user removal. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Machine-readable event kind, e.g. `login.failure`, `rate_limit.breach`. */
    eventType: text('event_type').notNull(),
    /** One of info | warning | critical (enforced by the CHECK below). */
    severity: text('severity').notNull(),
    /** Request source IP (native `inet`), when the event has one. */
    sourceIp: inet('source_ip'),
    /** Best-effort User-Agent, when the event has one. */
    userAgent: text('user_agent'),
    /** Structured, D7-clean detail. NEVER message content. */
    payload: jsonb('payload'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Set when an operator triages the event. */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    /** Operator who reviewed; nulled (not deleted) on that user's removal. */
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    /** Time-ordered firehose. */
    occurredAtIdx: index('security_events_occurred_at_idx').on(table.occurredAt.desc()),
    /** "Criticals, newest first" operator view. */
    severityOccurredIdx: index('security_events_severity_occurred_idx').on(
      table.severity,
      table.occurredAt.desc(),
    ),
    /** Severity is a closed set — reject typos at the DB boundary. */
    severityCheck: check(
      'security_events_severity_check',
      sql`${table.severity} IN ('info', 'warning', 'critical')`,
    ),
  }),
);

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;
