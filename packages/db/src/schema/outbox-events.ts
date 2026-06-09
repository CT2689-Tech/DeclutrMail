import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Outbox events (D13).
 *
 * Transactional outbox table: feature services INSERT one row inside the
 * same business-write transaction (e.g. `triage.applyVerdict` writes both
 * `action_operations` and an outbox row in a single tx). The
 * `OutboxDispatcherWorker` then claims pending rows with
 * `FOR UPDATE SKIP LOCKED`, hands the payload off to a domain consumer
 * (typically a BullMQ enqueue per D204's event-driven cross-feature
 * writes), and marks the row as dispatched.
 *
 * Hot path: workers wake on `LISTEN outbox_inserted` (Postgres pub/sub —
 * fires inside the same transaction via the per-row trigger created by
 * the migration). A 5s polling timer is a safety net for missed
 * notifications (worker restart, network blip, Postgres failover).
 *
 * Status enum:
 *   - `pending`     — newly inserted, not yet claimed
 *   - `dispatched`  — handed to the consumer successfully (terminal)
 *   - `failed`      — consumer threw after `attempts >= max`; left here
 *                     for the dead-letter inspection path. NOT auto-
 *                     retried; ops promotes back to `pending` if a fix
 *                     ships. (Per D203 the consumer worker has its own
 *                     retry/backoff; the dispatcher only flips to
 *                     `failed` after that ladder is exhausted.)
 *
 * `topic` is the typed event name per D204 convention
 * (`{feature}.{noun}_{past_participle}` — e.g. `triage.verdict_applied`).
 * It is what the dispatcher routes on. Kept as `text` rather than a
 * Postgres enum because the contract lives in
 * `packages/shared/contracts/events/` and grows with each feature; an
 * enum would couple migration cadence to feature shipping.
 *
 * `aggregate_id` is the domain entity the event is about (e.g. an action
 * operation id, a sender_key). The dispatcher does not interpret it; the
 * consumer uses it as the idempotency key on the downstream side (e.g.
 * BullMQ `jobId`).
 *
 * `payload` carries the full event body (Zod-validated by the
 * publisher). Per D7/D228 it MUST NOT include body content, attachments,
 * or non-allowlisted headers — same allowlist as `mail_messages`. The
 * publisher is the enforcement point; this table just stores whatever
 * the typed contract permits.
 *
 * Lifecycle columns:
 *   - `created_at`     — insert-time. Drives the FIFO claim order.
 *   - `dispatched_at`  — set on consumer success. Nullable; non-null
 *                        means terminal.
 *   - `attempts`       — bumped each time the dispatcher hands the row
 *                        to the consumer and the consumer throws.
 *   - `last_error`     — most recent consumer error message. Diagnostic
 *                        only; truncated by the dispatcher to keep
 *                        DELETE/UPDATE row sizes bounded.
 *
 * Indexes:
 *   - `(status, created_at)` partial WHERE `status='pending'` — D150 #11.
 *     The poller hot path is `SELECT ... WHERE status='pending'
 *     ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED`. The partial
 *     index lets Postgres scan only un-dispatched rows in arrival order
 *     without sorting the full table.
 *   - `(topic, created_at)` — supports ops queries ("show me all
 *     pending verdict_applied events") and the dead-letter inspection
 *     path without a sequential scan.
 *
 * Privacy (D7, D228): outbox rows carry domain identifiers + the typed
 * event payload; never raw message bodies, attachments, snippets, or
 * non-allowlisted headers. The publisher is the gate (Zod contracts).
 */

export const outboxStatus = pgEnum('outbox_status', ['pending', 'dispatched', 'failed']);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    /** Random UUID — also the idempotency anchor for the consumer. */
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Typed event topic, `{feature}.{noun}_{past_participle}` per D204.
     * The dispatcher routes on this; consumers MUST be idempotent on
     * `id` (consumer-side dedup, not dispatcher-side).
     */
    topic: text('topic').notNull(),
    /**
     * The domain entity the event is about (action operation id, sender
     * key, etc.). Opaque to the dispatcher; meaningful to the consumer.
     */
    aggregateId: text('aggregate_id').notNull(),
    /**
     * Typed event body — schema lives in
     * `packages/shared/contracts/events/`. The publisher validates
     * before insert; the dispatcher passes through.
     */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: outboxStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Set on consumer success — the claim transaction's terminal flip. */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'date' }),
    /** Bumped on each consumer failure; resets are an ops decision. */
    attempts: integer('attempts').notNull().default(0),
    /** Most recent consumer error message. Truncated to keep rows small. */
    lastError: text('last_error'),
  },
  (table) => ({
    /**
     * D150 #11: poller hot path. Partial index on pending rows by
     * arrival order keeps the dispatcher scan O(claim batch size).
     */
    pendingIdx: index('outbox_events_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    /** Ops + dead-letter inspection by topic. */
    topicCreatedIdx: index('outbox_events_topic_created_idx').on(table.topic, table.createdAt),
  }),
).enableRLS();

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type OutboxStatus = (typeof outboxStatus.enumValues)[number];
