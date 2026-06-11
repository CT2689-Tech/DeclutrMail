import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Account deletion requests — D232 (account deletion respects undo
 * windows) + D205/D216 scheduling.
 *
 * USER-scoped: D232's formula is per-user —
 *
 *   effective_at = max(now + 7 days, MAX(undo_journal.expires_at)
 *                                    across ALL the user's mailboxes)
 *
 * `basis` records WHICH branch of the formula produced `effective_at`:
 *   - 'flat-grace'        — now+7d won (no undo window extends past it).
 *   - 'undo-window'       — a live undo window (Pro 30d per D81) pushed
 *                           the date past the flat grace.
 *   - 'waived-immediate'  — user typed the literal `DELETE AND WAIVE
 *                           UNDO` confirmation (D232 waiver path);
 *                           deletion executes immediately.
 *
 * `waiver_confirmed` is true only when the exact waiver string matched.
 * The CHECK enforces the only impossible-by-design state: a
 * 'waived-immediate' request without a confirmed waiver.
 *
 * Status lifecycle: 'pending' → 'executing' → 'completed', or
 * 'pending' → 'cancelled' (user changes their mind during the grace
 * window). While a request is 'pending'/'executing', sync is paused
 * (D232 — otherwise Gmail would silently repopulate the index) and the
 * partial unique index guarantees at most one in-flight request per
 * user.
 *
 * The due-scan partial index serves the deletion cron's
 * `WHERE status = 'pending' AND effective_at <= now()` sweep (D225
 * cronPolicy job).
 *
 * `onDelete: 'cascade'` from users: executing the deletion removes the
 * user row and everything under it — including this request row. That
 * is deliberate (privacy posture: deletion means deletion); the
 * compliance evidence trail lives in `security_events` / structured
 * logs, not in retained per-user rows.
 *
 * No body data; no privacy concerns.
 */

/** Which branch of the D232 formula set `effective_at`. */
export const accountDeletionBasis = pgEnum('account_deletion_basis', [
  'flat-grace',
  'undo-window',
  'waived-immediate',
]);

export const accountDeletionStatus = pgEnum('account_deletion_status', [
  'pending',
  'cancelled',
  'executing',
  'completed',
]);

export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** D232: `max(now + 7d, latest_undo_expires_at)` — or `now()` when waived. */
    effectiveAt: timestamp('effective_at', { withTimezone: true, mode: 'date' }).notNull(),
    basis: accountDeletionBasis('basis').notNull(),
    /** True only when the literal `DELETE AND WAIVE UNDO` string matched. */
    waiverConfirmed: boolean('waiver_confirmed').notNull().default(false),
    status: accountDeletionStatus('status').notNull().default('pending'),
    /** When the user cancelled during the grace window; null otherwise. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    /** When the deletion job started executing; null until then. */
    executedAt: timestamp('executed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Deletion cron due-scan: pending requests whose effective_at has passed. */
    dueScanIdx: index('account_deletion_requests_due_scan_idx')
      .on(table.effectiveAt)
      .where(sql`${table.status} = 'pending'`),
    /** At most one in-flight deletion request per user. */
    userActiveUniq: uniqueIndex('account_deletion_requests_user_active_uniq')
      .on(table.userId)
      .where(sql`${table.status} IN ('pending', 'executing')`),
    /** A waived-immediate request without a confirmed waiver is impossible. */
    waiverConsistent: check(
      'account_deletion_requests_waiver_consistent',
      sql`${table.basis} <> 'waived-immediate' OR ${table.waiverConfirmed} = true`,
    ),
  }),
);

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest = typeof accountDeletionRequests.$inferInsert;
