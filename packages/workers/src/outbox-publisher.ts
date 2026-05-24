import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import { outboxEvents } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

/**
 * Either a Drizzle root client or an in-flight transaction handle.
 *
 * Callers SHOULD pass the transaction handle from their own
 * `db.transaction(async (tx) => { ... })` so the outbox insert commits
 * atomically with the business write (the whole point of a
 * transactional outbox).
 *
 * Passing the root client is supported for the rare case where the
 * publisher is the only writer (e.g. a backfill script with no
 * business-write neighbor). The trigger still fires
 * `pg_notify('outbox_inserted', ...)` and the dispatcher wakes — just
 * without the atomicity guarantee a tx provides.
 */
export type OutboxTx =
  | PostgresJsDatabase<typeof schema>
  | PgTransaction<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      typeof schema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;

/**
 * One outbox event before insert. `topic` follows D204's
 * `{feature}.{noun}_{past_participle}` convention; `payload` MUST be
 * Zod-validated against the publisher's contract in
 * `packages/shared/contracts/events/` BEFORE this call (this helper
 * does not see the Zod schema — keeping it generic across topics).
 */
export interface OutboxPublishInput<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  topic: string;
  aggregateId: string;
  payload: TPayload;
}

/**
 * OutboxPublisher (D13) — the single seam every cross-feature write
 * goes through. Inserts a row into `outbox_events` inside the caller's
 * transaction; the AFTER INSERT trigger emits
 * `pg_notify('outbox_inserted', NEW.id::text)` so the dispatcher wakes
 * on commit.
 *
 * Why a helper instead of letting features call `tx.insert(outboxEvents)`
 * directly?
 *   - One place to enforce the topic-name convention (a future check
 *     can reject malformed topics here without touching every caller).
 *   - One place to attach Zod validation when the contract layer lands
 *     (D204).
 *   - One place for `architecture-guardian` to look for cross-feature
 *     writes — direct `tx.insert(outboxEvents)` is auditable as a
 *     deviation.
 *
 * Privacy posture (D7, D228): the publisher does NOT inspect payload
 * contents; the typed-contract layer (Zod schemas in
 * `packages/shared/contracts/events/`) is the gate. This helper
 * inserts whatever the caller passes — callers are responsible for
 * keeping body content out of `payload`.
 */
export class OutboxPublisher {
  /**
   * Insert one event into `outbox_events`. Returns the new row's id so
   * callers can correlate downstream consumer activity back to the
   * publish.
   *
   * Use inside a transaction: `await db.transaction(async (tx) => {
   *   await this.queries.insertOperation(tx, op);
   *   await this.outbox.publish(tx, { topic, aggregateId, payload });
   * });`
   *
   * The trigger fires `pg_notify('outbox_inserted', NEW.id::text)`
   * inside the same transaction — Postgres buffers the notification
   * until commit, so listening dispatchers cannot read a not-yet-
   * visible row.
   */
  async publish<TPayload extends Record<string, unknown>>(
    tx: OutboxTx,
    input: OutboxPublishInput<TPayload>,
  ): Promise<string> {
    const [row] = await tx
      .insert(outboxEvents)
      .values({
        topic: input.topic,
        aggregateId: input.aggregateId,
        payload: input.payload,
      })
      .returning({ id: outboxEvents.id });
    if (!row) {
      // Should be unreachable — INSERT ... RETURNING always returns
      // the inserted row absent a tx rollback. Surface explicitly so a
      // future driver change does not silently degrade.
      throw new Error('OutboxPublisher.publish: insert returned no row');
    }
    return row.id;
  }
}
