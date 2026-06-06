import { eq, sql } from 'drizzle-orm';
import { senderPolicies } from '@declutrmail/db';
import { ActionsUnsubscribeIntentRecordedPayloadSchema, TOPICS } from '@declutrmail/events';
import type { ActionsUnsubscribeIntentRecordedPayload } from '@declutrmail/events';
import type { DispatchedEvent } from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';

/**
 * Outbox consumer router (D13, D204).
 *
 * Receives every `outbox_events` row claimed by the OutboxDispatcherWorker
 * and routes by topic to the senders-owned projection handler. Adding a
 * new topic is a one-line `case` here; an unknown topic falls through to
 * the default branch which logs + does nothing (so a published event
 * the API doesn't recognize doesn't fail the dispatcher — the operator
 * sees the gap in Cloud Logging instead).
 *
 * Why a router instead of one consumer per topic?
 *   - One LISTEN + one dispatcher process → one consumer port. Routing
 *     by topic on the dispatched event keeps the dispatcher's contract
 *     simple while letting each feature own its own projection function.
 *   - Per-feature handlers can co-locate with the table they project
 *     into; this file is the seam, not the projection logic itself.
 *
 * Privacy posture (D7, D228): consumers receive the already-validated
 * payload from the publisher's Zod schema. Each handler MUST treat the
 * payload as metadata-only; no message content is ever in it (publisher
 * gates enforce this).
 */
export function buildOutboxConsumer(db: DrizzleDb) {
  return async function consumeOutboxEvent(event: DispatchedEvent): Promise<void> {
    switch (event.topic) {
      case TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED: {
        // Defense-in-depth Zod re-parse on the consumer side
        // (typescript-reviewer 2026-06-06). The publisher already
        // validates against the same schema before insert, so this
        // duplicates effort on the happy path — but the column type is
        // jsonb → unknown, so a hand-rolled INSERT or a future
        // publisher path that bypasses OutboxPublisher would otherwise
        // flow garbage into the handler. The parse step gives Sentry a
        // clean ZodError on shape drift instead of a downstream
        // "undefined is not an object."
        const payload = ActionsUnsubscribeIntentRecordedPayloadSchema.parse(event.payload);
        await handleUnsubscribeIntentRecorded(db, payload);
        return;
      }
      default:
        // Topic the API doesn't recognize. Log + ACK so the row flips
        // to `dispatched` rather than blocking the queue. A future
        // consumer can subscribe; the publisher contract is "fire and
        // forget the routing". Log at WARN (not INFO) so the count
        // surfaces in default log filters; default kind name renamed
        // from `no_handler` to `unknown_topic` for grep clarity
        // (silent-failure-hunter 2026-06-06).
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'outbox.consumer.unknown_topic',
            topic: event.topic,
            eventId: event.id,
          }),
        );
        return;
    }
  };
}

/**
 * Senders projection — `sender_policies.policy_type = 'unsubscribe'`.
 *
 * D204 boundary: the senders feature owns the `sender_policies` table,
 * so the upsert lives here (not in ActionsService). The event carries
 * the sender_key directly (no resolve step needed).
 *
 * Idempotent — onConflictDoUpdate overwrites the same row whether this
 * is the first projection of the event or a redelivered one. We do NOT
 * touch `is_protected` / `is_vip` / `protection_reason` so a Protect
 * override stays preserved (a sender can be both "Protect to avoid
 * bulk" + "Unsub pending" until the brand honours the unsub).
 */
async function handleUnsubscribeIntentRecorded(
  db: DrizzleDb,
  payload: ActionsUnsubscribeIntentRecordedPayload,
): Promise<void> {
  await db
    .insert(senderPolicies)
    .values({
      mailboxAccountId: payload.mailboxAccountId,
      senderKey: payload.senderKey,
      policyType: 'unsubscribe',
    })
    .onConflictDoUpdate({
      target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
      set: {
        policyType: 'unsubscribe',
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Exposed for tests so the consumer's handler logic can be exercised
 * without spinning up a dispatcher tick + an outbox_events row.
 */
export const __internals = {
  handleUnsubscribeIntentRecorded,
};

// Drizzle eq import retained for future consumer handlers; keep tree-
// shake friendly.
void eq;
