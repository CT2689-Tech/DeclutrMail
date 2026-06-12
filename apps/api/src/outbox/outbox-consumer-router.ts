import { eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { senderPolicies } from '@declutrmail/db';
import {
  ActionsUnsubscribeIntentRecordedPayloadSchema,
  MailboxSyncReadyPayloadSchema,
  TOPICS,
  TriageScoreRunCompletedPayloadSchema,
  TriageVerdictAppliedPayloadSchema,
} from '@declutrmail/events';
import type {
  ActionsUnsubscribeIntentRecordedPayload,
  TriageVerdictAppliedPayload,
} from '@declutrmail/events';
import {
  AUTOPILOT_APPLY_JOB,
  seedAutopilotPresets,
  type AutopilotApplyJobData,
  type DispatchedEvent,
} from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';

/**
 * Optional consumer dependencies beyond the db handle (U14).
 *
 * `autopilotApplyQueue` — BullMQ producer for the `autopilot-apply`
 * queue. Optional because the worker composition root
 * (`apps/api/src/worker.ts`) is integration-owned this wave: the
 * router compiles + runs without it, and the autopilot cases log a
 * structured `autopilot_queue_unwired` warning instead of silently
 * dropping the trigger. The integration PR passes the queue.
 */
export interface OutboxConsumerDeps {
  autopilotApplyQueue?: Queue<AutopilotApplyJobData> | null;
}

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
export function buildOutboxConsumer(db: DrizzleDb, deps: OutboxConsumerDeps = {}) {
  return async function consumeOutboxEvent(event: DispatchedEvent): Promise<void> {
    switch (event.topic) {
      case TOPICS.MAILBOX_SYNC_READY: {
        // U14 — Autopilot bootstrap on first ready (D10, D99, D101).
        // 1. Seed the 5 D101 preset rules — idempotent (`ON CONFLICT
        //    DO NOTHING` on the partial unique), so a RESUMED sync
        //    that re-reaches ready is a no-op.
        // 2. Enqueue an `autopilot-apply` sweep so enabled rules run
        //    against the fresh sender index. jobId carries the ready
        //    timestamp — a redelivered event dedups at BullMQ.
        const payload = MailboxSyncReadyPayloadSchema.parse(event.payload);
        await seedAutopilotPresets(db, payload.mailboxAccountId);
        await enqueueAutopilotApply(deps, {
          mailboxAccountId: payload.mailboxAccountId,
          triggeredAtMs: Date.parse(payload.readyAt),
        });
        return;
      }
      case TOPICS.TRIAGE_SCORE_RUN_COMPLETED: {
        // U14 — score run finished ⇒ decisions are fresh ⇒ run the
        // Autopilot matchers (D99/D104). jobId reuses the score run's
        // `producedAtMs` so a republished event (BullMQ retry of the
        // score job) collapses to one apply sweep.
        const payload = TriageScoreRunCompletedPayloadSchema.parse(event.payload);
        await enqueueAutopilotApply(deps, {
          mailboxAccountId: payload.mailboxAccountId,
          triggeredAtMs: payload.producedAtMs,
        });
        return;
      }
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
      case TOPICS.TRIAGE_VERDICT_APPLIED: {
        // Same defense-in-depth re-parse as the unsubscribe case.
        const payload = TriageVerdictAppliedPayloadSchema.parse(event.payload);
        await handleTriageVerdictApplied(db, payload);
        return;
      }
      case TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED:
        // Observability-only (D9 Wave 2): `UnsubExecutionWorker` writes
        // the durable effects itself in its terminal tx; this event
        // exists for Cloud Logging / future audit consumers. ACK
        // explicitly so the dispatcher doesn't WARN `unknown_topic` on
        // every unsubscribe.
        return;
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
 * Enqueue one `autopilot-apply` sweep (U14). Fail-open on a missing
 * queue: the event still ACKs (the dispatcher must not wedge on a
 * registration gap), but the dropped trigger is logged at WARN so the
 * gap surfaces in Cloud Logging until the integration PR wires the
 * queue. `jobId = ${mailbox}-${triggeredAtMs}` mirrors the apply
 * worker's idempotency key with `-` instead of `:` — BullMQ reserves
 * `:` as its Redis key separator and REJECTS custom ids containing it
 * (caught live in the U14 smoke: `Error: Custom Id cannot contain :`).
 */
async function enqueueAutopilotApply(
  deps: OutboxConsumerDeps,
  job: AutopilotApplyJobData,
): Promise<void> {
  if (!deps.autopilotApplyQueue) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'outbox.consumer.autopilot_queue_unwired',
        mailboxAccountId: job.mailboxAccountId,
      }),
    );
    return;
  }
  await deps.autopilotApplyQueue.add(AUTOPILOT_APPLY_JOB, job, {
    jobId: `${job.mailboxAccountId}-${job.triggeredAtMs}`,
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  });
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
  // D9 Wave 2 — `unsub_status` projection. 'pending' only for a
  // one_click intent (an execution job is in flight); mailto/none and
  // legacy events (no `method` field) project NULL — the manual path
  // never claims an outcome (D230). Guarded with `coalesce` against
  // the executed-before-intent dispatch race: the dispatcher processes
  // rows in insert order, so in practice intent precedes execution,
  // but a redelivered intent event must not stomp a terminal status
  // back to 'pending' — see the WHERE-less upsert note below.
  const unsubStatus = payload.method === 'one_click' ? ('pending' as const) : null;
  await db
    .insert(senderPolicies)
    .values({
      mailboxAccountId: payload.mailboxAccountId,
      senderKey: payload.senderKey,
      policyType: 'unsubscribe',
      unsubStatus,
    })
    .onConflictDoUpdate({
      target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
      set: {
        policyType: 'unsubscribe',
        // Redelivery safety: only move a NULL/'pending' status to
        // 'pending' — never regress a terminal outcome the worker
        // already recorded for THIS intent generation.
        unsubStatus:
          unsubStatus === 'pending'
            ? sql`CASE WHEN ${senderPolicies.unsubStatus} IS NULL OR ${senderPolicies.unsubStatus} = 'pending' THEN 'pending'::unsub_status ELSE ${senderPolicies.unsubStatus} END`
            : null,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Senders projection — `sender_policies.policy_type = 'keep'`.
 *
 * Produced by `ActionsService.recordKeepIntent` (the user's Keep
 * verdict — D40's "records sender_policy(policy_type=keep)" contract).
 * D204 boundary: the senders feature owns `sender_policies`, so the
 * upsert lives here, not in ActionsService.
 *
 * Only `verdict='keep'` projects a policy today: Archive/Later/Delete
 * decisions are one-time mutations (the label-action worker is their
 * single effect-writer) and Unsubscribe has its own dedicated topic.
 * A non-keep verdict event is valid but carries no projection — ACK
 * and move on. The `is_protected` / `is_vip` modifiers are never
 * touched (Keep ≠ Protect; manifest-entries.ts keep docstring).
 */
async function handleTriageVerdictApplied(
  db: DrizzleDb,
  payload: TriageVerdictAppliedPayload,
): Promise<void> {
  if (payload.verdict !== 'keep') {
    return;
  }
  await db
    .insert(senderPolicies)
    .values({
      mailboxAccountId: payload.mailboxAccountId,
      senderKey: payload.senderKey,
      policyType: 'keep',
    })
    .onConflictDoUpdate({
      target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
      set: {
        policyType: 'keep',
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
  handleTriageVerdictApplied,
};

// Drizzle eq import retained for future consumer handlers; keep tree-
// shake friendly.
void eq;
