import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { billingProvider } from './billing-customers';

/**
 * Subscription events — the normalized single stream both billing
 * providers' webhooks land in (D117).
 *
 * Paddle and Razorpay deliver at-least-once; `(provider,
 * provider_event_id)` is unique so the webhook handler's
 * `INSERT … ON CONFLICT DO NOTHING` is the atomic dedup/replay gate
 * (same pattern as `webhook_dedup` for Gmail Pub/Sub). If the insert
 * affects 0 rows, the event was already recorded — ack and exit.
 *
 * `event_type` is the provider's event name verbatim
 * (`subscription.updated`, `subscription.charged`, …) — normalization
 * to domain effects happens in the handler, not the store.
 *
 * `payload` is the provider's webhook body as received (post
 * signature verification). It carries billing metadata only —
 * subscription/customer/price ids, amounts, statuses, and D118's
 * optional cancellation reason. Never email content; D7/D228
 * unaffected.
 *
 * `processed_at` — null until the handler has applied the event's
 * domain effect (tier flip, status update). The partial index on
 * unprocessed rows powers the recovery scan that re-drives events
 * whose processing crashed mid-flight (insert committed, effect
 * didn't), mirroring the `outbox_events` pending pattern.
 *
 * Append-only except `processed_at`.
 */

export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: billingProvider('provider').notNull(),
    /** Provider's event id (Paddle `evt_…` / Razorpay event id). */
    providerEventId: text('provider_event_id').notNull(),
    /** Provider event name verbatim, e.g. `subscription.updated`. */
    eventType: text('event_type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Null until the domain effect has been applied. */
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Webhook dedup/replay gate — `ON CONFLICT DO NOTHING` target. */
    providerEventUniq: uniqueIndex('subscription_events_provider_event_uniq').on(
      table.provider,
      table.providerEventId,
    ),
    /** Recovery scan for events recorded but not yet applied. */
    pendingIdx: index('subscription_events_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.processedAt} IS NULL`),
  }),
);

export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEvent = typeof subscriptionEvents.$inferInsert;
