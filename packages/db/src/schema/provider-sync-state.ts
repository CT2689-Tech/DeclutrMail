import { sql } from 'drizzle-orm';
import {
  bigint,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Provider sync state — one row per mailbox account tracking sync
 * progress and the incremental-sync cursor (D224).
 *
 * `readiness_status` is the coarse state the onboarding gate reads;
 * `current_stage` is the fine-grained stage the D109 stage indicator
 * animates through. `progress_pct` (0-100) drives the progress bar.
 * The `GET /api/v1/sync/state` endpoint returns
 * `{readiness_status, current_stage, progress_pct, error_code?}` and the
 * `useSyncStatus()` hook polls it every 3s (D200) — there is no push
 * transport.
 *
 * `last_history_id` is the Gmail `historyId` cursor for incremental
 * sync. Per the D229 webhook checklist it must be monotonic — an
 * inbound history event whose id is `<=` this value is rejected as a
 * duplicate / out-of-order delivery. Stored as bigint (Gmail historyId
 * is an unsigned 64-bit counter).
 *
 * `(mailbox_account_id)` is unique — exactly one sync-state row per
 * mailbox.
 *
 * No body data; no privacy concerns.
 */

export const syncReadiness = pgEnum('sync_readiness', ['queued', 'syncing', 'ready', 'failed']);

export const syncStage = pgEnum('sync_stage', [
  'queued',
  'fetching_metadata',
  'building_sender_index',
  'computing_recommendations',
  'finalizing',
  'ready',
  'failed',
]);

export const providerSyncState = pgTable(
  'provider_sync_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    readinessStatus: syncReadiness('readiness_status').notNull().default('queued'),
    currentStage: syncStage('current_stage').notNull().default('queued'),
    progressPct: smallint('progress_pct').notNull().default(0),
    /** Gmail historyId cursor — must advance monotonically (D229). */
    lastHistoryId: bigint('last_history_id', { mode: 'bigint' }),
    errorCode: text('error_code'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    mailboxUniq: uniqueIndex('provider_sync_state_mailbox_account_uniq').on(table.mailboxAccountId),
  }),
);

export type ProviderSyncState = typeof providerSyncState.$inferSelect;
export type NewProviderSyncState = typeof providerSyncState.$inferInsert;
