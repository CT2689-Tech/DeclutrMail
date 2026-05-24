import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

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
 * Privacy denylist (D7, D228). Outbox payloads are runtime-checked
 * against these top-level key names; any match is rejected before the
 * row hits Postgres. This is *defense in depth* — the typed Zod schema
 * the caller passes is the primary gate (compile-time + structural
 * validation); the denylist catches the case where a future schema
 * accidentally widens to allow a body field.
 *
 * Kept as a `Set<string>` so the check is O(1) per payload key. Keys
 * are matched case-sensitively at the TOP LEVEL only — nested
 * structures are the schema author's responsibility (a Zod schema that
 * lets `body` through nested would already be a privacy bug at the
 * contract layer).
 */
const PII_KEYS: ReadonlySet<string> = new Set([
  'subject',
  'snippet',
  'body',
  'htmlBody',
  'rawMime',
  'headers',
]);

function assertNoBodyKeys(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (PII_KEYS.has(key)) {
      throw new Error(
        `[D7/D228] OutboxPublisher payload key "${key}" is on the privacy denylist. ` +
          'Outbox events must not carry body / snippet / header data. ' +
          'Project to a metric-only shape before publishing.',
      );
    }
  }
}

/**
 * One outbox event before insert. `topic` follows D204's
 * `{feature}.{noun}_{past_participle}` convention; `payload` MUST match
 * the `schema` Zod validator passed alongside it.
 */
export interface OutboxPublishInput<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  topic: string;
  aggregateId: string;
  payload: TPayload;
  /**
   * REQUIRED Zod schema for the payload shape (D7/D228 gate). The
   * publisher runs `schema.parse(payload)` before insert; callers
   * SHOULD use `z.object({...}).strict()` so unknown keys are rejected
   * — strict mode is what makes the contract a *gate* rather than a
   * suggestion.
   *
   * Why required (not optional with a default any-schema)? An optional
   * schema lets a new feature slip a raw `Record<string, unknown>`
   * through without realising they bypassed the privacy contract. Making
   * it a required positional arg means the type system itself forces
   * every call site to think about the payload shape.
   */
  schema: z.ZodSchema<TPayload>;
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
 *   - One place to enforce Zod payload validation per the typed-event
 *     contract layer (D204).
 *   - One place for `architecture-guardian` to look for cross-feature
 *     writes — direct `tx.insert(outboxEvents)` is auditable as a
 *     deviation.
 *
 * Privacy posture (D7, D228): two gates, defense-in-depth:
 *   1. Caller-provided Zod schema (required) — compile-time + structural
 *      validation of payload shape.
 *   2. Runtime PII-key denylist — rejects payloads whose top-level keys
 *      look like body / snippet / header data, even if a buggy schema
 *      would let them through.
 *
 * If both gates pass, the row is inserted as-is.
 */
export class OutboxPublisher {
  /**
   * Insert one event into `outbox_events`. Returns the new row's id so
   * callers can correlate downstream consumer activity back to the
   * publish.
   *
   * Use inside a transaction:
   * ```
   * await db.transaction(async (tx) => {
   *   await this.queries.insertOperation(tx, op);
   *   await this.outbox.publish(tx, {
   *     topic: 'triage.verdict_applied',
   *     aggregateId: op.id,
   *     payload: { verdict: 'archive' },
   *     schema: z.object({ verdict: z.string() }).strict(),
   *   });
   * });
   * ```
   *
   * The trigger fires `pg_notify('outbox_inserted', NEW.id::text)`
   * inside the same transaction — Postgres buffers the notification
   * until commit, so listening dispatchers cannot read a not-yet-
   * visible row.
   *
   * Throws on contract violations:
   *   - `ZodError` if the payload fails `schema.parse()`.
   *   - `Error('[D7/D228] OutboxPublisher payload key "X" is on the
   *     privacy denylist…')` if a top-level key matches PII names.
   * Both throw BEFORE the insert, so the caller's tx is free to roll
   * back without a half-published event.
   */
  async publish<TPayload extends Record<string, unknown>>(
    tx: OutboxTx,
    input: OutboxPublishInput<TPayload>,
  ): Promise<string> {
    // Gate 1: Zod schema validation (caller-provided contract).
    const validated = input.schema.parse(input.payload);
    // Gate 2: PII-key denylist (defense-in-depth; runs on the *parsed*
    // payload so a Zod transform that adds a key still gets caught).
    assertNoBodyKeys(validated);

    const [row] = await tx
      .insert(outboxEvents)
      .values({
        topic: input.topic,
        aggregateId: input.aggregateId,
        payload: validated,
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
