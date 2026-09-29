import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { outboxEvents, schema } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';

import {
  OUTBOX_NOTIFY_CHANNEL,
  OutboxConsumerTimeoutError,
  OutboxDispatcherWorker,
  type DispatchedEvent,
  type OutboxConsumer,
  type OutboxObserver,
} from './outbox-dispatcher.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import type { BackgroundFailureContext } from './worker-observer.js';

/** Shared schemas for the test publishes (mirror what production callers pass). */
const VerdictPayload = z.object({ verdict: z.string() }).strict();
const EmptyPayload = z.object({}).strict();
const RuleFiredPayload = z.object({ ruleId: z.string() }).strict();

/**
 * OutboxDispatcherWorker integration tests (D13).
 *
 * Runs the real dispatcher + publisher against an in-process PGlite
 * database with every migration applied. Covers:
 *
 *   - publisher publish → dispatcher tick → consumer invoked
 *   - trigger fires `pg_notify('outbox_inserted', NEW.id::text)` (the
 *     LISTEN/NOTIFY wake-up path) inside the publisher's transaction
 *   - LISTEN handler wakes a tick faster than the polling interval
 *   - consumer failure increments `attempts` + records `last_error`
 *     and leaves the row pending for the next tick
 *   - `maxAttempts` consumer throws flips status to `failed`
 *   - one consumer panic does NOT poison the rest of the batch
 *     (savepoint isolation)
 *   - SKIP LOCKED concurrency: documented limitation — PGlite is single-
 *     connection so two dispatchers in the same process cannot prove
 *     row-level locking. The SKIP LOCKED clause is asserted at the SQL
 *     level (a regex check on the executed query string); an opt-in
 *     real-Postgres test (see end of file) proves the behavior end-to-
 *     end when `OUTBOX_TEST_PG_URL` is set.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Fresh PGlite DB with every migration applied (in file-order). */
async function freshDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = await freshTestPglite();
  const db = drizzle(pg, { schema });
  return { db, pg };
}

/**
 * Drive a dispatcher built around the given DB + consumer. PGlite's
 * `listen()` returns a teardown fn; the dispatcher port shape is
 * compatible (returns `() => Promise<void>`).
 *
 * NB: dispatcher is typed for postgres-js `PostgresJsDatabase` because
 * production uses postgres-js. PGlite's drizzle client shares the
 * query-builder shape; the cast is the same one InitialSyncWorker tests
 * use (`as unknown as ...`).
 */
function makeDispatcher(
  db: Db,
  consumer: OutboxConsumer,
  opts: {
    pg?: PGlite;
    pollIntervalMs?: number;
    maxAttempts?: number;
    observer?: OutboxObserver;
  } = {},
): OutboxDispatcherWorker {
  return new OutboxDispatcherWorker({
    // PGlite client is structurally compatible with PostgresJsDatabase for
    // our query shapes; the cast matches InitialSyncWorker test convention.
    db: db as unknown as PostgresJsDatabase<typeof schema>,
    consumer,
    pollIntervalMs: opts.pollIntervalMs ?? 60_000, // off by default in unit tests
    maxAttempts: opts.maxAttempts ?? 5,
    ...(opts.observer ? { observer: opts.observer } : {}),
    ...(opts.pg
      ? {
          listen: async (handler) => {
            const unsub = await opts.pg!.listen(OUTBOX_NOTIFY_CHANNEL, () => handler());
            return async () => {
              await unsub();
            };
          },
        }
      : {}),
  });
}

describe('OutboxDispatcherWorker', () => {
  let activeDispatcher: OutboxDispatcherWorker | null = null;
  let activePg: PGlite | null = null;

  afterEach(async () => {
    if (activeDispatcher) {
      await activeDispatcher.stop();
      activeDispatcher = null;
    }
    if (activePg) {
      await activePg.close();
      activePg = null;
    }
  });

  it('publishes a row inside a transaction and the dispatcher dispatches it', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();
    const received: DispatchedEvent[] = [];

    // Publish inside a tx (the production-shaped call site — atomic with
    // any business write the caller does in the same tx).
    await db.transaction(async (tx) => {
      await publisher.publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'op-1',
        payload: { verdict: 'archive' },
        schema: VerdictPayload,
      });
    });

    const dispatcher = makeDispatcher(db, async (e) => {
      received.push(e);
    });
    activeDispatcher = dispatcher;
    const result = await dispatcher.tick();

    expect(result).toEqual({
      claimed: 1,
      dispatched: 1,
      consumerFailed: 0,
      consumerTimedOut: 0,
      flippedToFailed: 0,
      skippedOrphaned: 0,
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.topic).toBe('triage.verdict_applied');
    expect(received[0]?.aggregateId).toBe('op-1');
    expect(received[0]?.payload).toEqual({ verdict: 'archive' });

    // Row flipped to dispatched + has a dispatched_at.
    const rows = await db.select().from(outboxEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('dispatched');
    expect(rows[0]?.dispatchedAt).toBeInstanceOf(Date);
    expect(rows[0]?.attempts).toBe(0);
    expect(rows[0]?.lastError).toBeNull();
  });

  it('AFTER INSERT trigger emits pg_notify on the outbox_inserted channel', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;

    const received: string[] = [];
    await pg.listen(OUTBOX_NOTIFY_CHANNEL, (payload) => {
      received.push(payload);
    });

    let publishedId = '';
    await db.transaction(async (tx) => {
      publishedId = await new OutboxPublisher().publish(tx, {
        topic: 'sync.history_processed',
        aggregateId: 'mb-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    // Give PGlite's notification queue a microtask to flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain(publishedId);
  });

  it('LISTEN handler wakes a tick before the polling interval fires', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const received: DispatchedEvent[] = [];

    // pollIntervalMs is intentionally LONG — if the LISTEN wake-up
    // didn't work, this test would time out instead of completing in
    // a few ms.
    const dispatcher = makeDispatcher(
      db,
      async (e) => {
        received.push(e);
      },
      { pg, pollIntervalMs: 60_000 },
    );
    activeDispatcher = dispatcher;
    await dispatcher.start();

    // Initial drain after start saw nothing — table is empty.
    expect(received).toHaveLength(0);

    // Publish — the AFTER INSERT trigger fires pg_notify; the LISTEN
    // handler calls the dispatcher's wake which runs a tick.
    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'wake-1',
        payload: { verdict: 'keep' },
        schema: VerdictPayload,
      });
    });

    // Poll the consumer received-set briefly; the wake should land
    // well under the 60s pollIntervalMs.
    const deadline = Date.now() + 2_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(received).toHaveLength(1);
    expect(received[0]?.aggregateId).toBe('wake-1');
  });

  it('consumer failure increments attempts and records last_error; row stays pending', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();
    let id = '';
    await db.transaction(async (tx) => {
      id = await publisher.publish(tx, {
        topic: 'autopilot.rule_fired',
        aggregateId: 'rule-1',
        payload: { ruleId: 'preset-1' },
        schema: RuleFiredPayload,
      });
    });

    const dispatcher = makeDispatcher(
      db,
      async () => {
        throw new Error('downstream queue offline');
      },
      { maxAttempts: 3 },
    );
    activeDispatcher = dispatcher;
    const result = await dispatcher.tick();

    expect(result).toMatchObject({
      claimed: 1,
      dispatched: 0,
      consumerFailed: 1,
      flippedToFailed: 0,
    });

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain('downstream queue offline');
    expect(row?.dispatchedAt).toBeNull();
  });

  it('flips status to failed once attempts reaches maxAttempts', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'op-fail',
        payload: {},
        schema: EmptyPayload,
      });
    });

    const dispatcher = makeDispatcher(
      db,
      async () => {
        throw new Error('always broken');
      },
      { maxAttempts: 2 },
    );
    activeDispatcher = dispatcher;

    // First tick → attempts becomes 1, stays pending.
    await dispatcher.tick();
    let [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);

    // Second tick → attempts reaches maxAttempts(2), flips to failed.
    const second = await dispatcher.tick();
    expect(second.flippedToFailed).toBe(1);
    [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(2);
    expect(row?.lastError).toContain('always broken');

    // Failed row is NOT re-claimed by subsequent ticks.
    const third = await dispatcher.tick();
    expect(third.claimed).toBe(0);
  });

  it('logs every consumer failure, and hands the row it gives up on to the observer once', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'op-report',
        payload: {},
        schema: EmptyPayload,
      });
    });
    const captured: BackgroundFailureContext[] = [];
    const dispatcher = makeDispatcher(
      db,
      async () => {
        throw new Error('always broken');
      },
      {
        maxAttempts: 2,
        observer: { captureBackgroundFailure: (_error, context) => void captured.push(context) },
      },
    );
    activeDispatcher = dispatcher;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Attempt 1: retried later, so logged but not captured.
      await dispatcher.tick();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('outbox.dispatch.consumer_failed'));
      expect(captured).toEqual([]);

      // Attempt 2 flips the row to `failed`: nothing will claim it again.
      await dispatcher.tick();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('outbox.dispatch.event_failed'));
      expect(captured).toHaveLength(1);
      // `topic`/`event_id` MUST be under `tags` — the production adapter
      // (`sentry-worker-observer.ts`) reads only `kind` and `tags`, and a
      // sibling of `kind` reaches it and is silently dropped. This is the
      // exact shape of the 2026-09-28 regression.
      expect(captured[0]).not.toHaveProperty('topic');
      expect(captured[0]).not.toHaveProperty('eventId');
      expect(captured[0]).toEqual(
        expect.objectContaining({
          kind: 'outbox.dispatch.event_failed',
          tags: expect.objectContaining({ topic: 'triage.verdict_applied' }),
        }),
      );

      await dispatcher.tick();
      expect(captured).toHaveLength(1);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('isolates a panicking consumer: other rows in the same batch still dispatch', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();
    const goodIds: string[] = [];
    let badId = '';

    await db.transaction(async (tx) => {
      goodIds.push(
        await publisher.publish(tx, {
          topic: 'triage.verdict_applied',
          aggregateId: 'good-1',
          payload: {},
          schema: EmptyPayload,
        }),
      );
      badId = await publisher.publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'bad',
        payload: {},
        schema: EmptyPayload,
      });
      goodIds.push(
        await publisher.publish(tx, {
          topic: 'triage.verdict_applied',
          aggregateId: 'good-2',
          payload: {},
          schema: EmptyPayload,
        }),
      );
    });

    const dispatcher = makeDispatcher(
      db,
      async (event) => {
        if (event.aggregateId === 'bad') {
          throw new Error('consumer panic');
        }
      },
      { maxAttempts: 5 },
    );
    activeDispatcher = dispatcher;
    const result = await dispatcher.tick();
    expect(result.claimed).toBe(3);
    expect(result.dispatched).toBe(2);
    expect(result.consumerFailed).toBe(1);

    const rows = await db.select().from(outboxEvents);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const goodId of goodIds) {
      expect(byId.get(goodId)?.status).toBe('dispatched');
    }
    expect(byId.get(badId)?.status).toBe('pending');
    expect(byId.get(badId)?.attempts).toBe(1);
  });

  it('claim query includes FOR UPDATE SKIP LOCKED (SQL-level guarantee)', async () => {
    // PGlite is single-connection, so the runtime behavior of SKIP
    // LOCKED can't be observed across two concurrent transactions in-
    // process. Assert the SQL itself contains the clause by reading
    // the dispatcher's source — guarantees the literal clause is in
    // the executed query without depending on a PGlite spy hook that
    // varies with driver internals.
    const dispatcherSource = readFileSync(
      join(import.meta.dirname, 'outbox-dispatcher.worker.ts'),
      'utf8',
    );
    expect(dispatcherSource).toMatch(/SELECT[\s\S]+outbox_events[\s\S]+FOR UPDATE SKIP LOCKED/);
  });

  it('start() drains existing backlog before the first polling tick', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'sync.history_processed',
        aggregateId: 'pre-existing',
        payload: {},
        schema: EmptyPayload,
      });
    });

    const received: DispatchedEvent[] = [];
    const dispatcher = makeDispatcher(
      db,
      async (e) => {
        received.push(e);
      },
      { pg, pollIntervalMs: 60_000 },
    );
    activeDispatcher = dispatcher;
    await dispatcher.start();

    expect(received).toHaveLength(1);
    expect(received[0]?.aggregateId).toBe('pre-existing');
  });

  it('rejects payloads whose top-level key is on the privacy denylist (D7/D228)', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();
    // A naïve caller could write a schema that allows `subject` through
    // — the denylist is the defense-in-depth gate that still rejects.
    const BodyShapedPayload = z
      .object({
        subject: z.string(),
      })
      .strict() as unknown as z.ZodSchema<{ subject: string }>;

    await expect(
      db.transaction(async (tx) => {
        await publisher.publish(tx, {
          topic: 'triage.verdict_applied',
          aggregateId: 'leak-1',
          payload: { subject: 'Q4 board update' },
          schema: BodyShapedPayload,
        });
      }),
    ).rejects.toThrow(/privacy denylist/);

    // Row was NOT inserted (the publisher threw inside the tx → rollback).
    const rows = await db.select().from(outboxEvents);
    expect(rows).toHaveLength(0);
  });

  it('rejects payloads that fail the caller-provided Zod schema (D204 contract gate)', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();

    await expect(
      db.transaction(async (tx) => {
        await publisher.publish(tx, {
          topic: 'triage.verdict_applied',
          aggregateId: 'bad-shape',
          // Deliberate type-system bypass to model a runtime contract
          // violation (e.g. an upstream feature whose internal type
          // drifted from its publisher schema).
          payload: { wrongKey: 123 } as unknown as { verdict: string },
          schema: VerdictPayload,
        });
      }),
    ).rejects.toThrow();

    const rows = await db.select().from(outboxEvents);
    expect(rows).toHaveLength(0);
  });

  it('drops NOTIFY-triggered ticks past maxPendingTicks (back-pressure)', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;

    let releaseConsumer!: () => void;
    const consumerHolding = new Promise<void>((r) => {
      releaseConsumer = r;
    });

    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'sync.history_processed',
        aggregateId: 'bp-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    // Capture dropped-backpressure log lines.
    const droppedLines: string[] = [];
    const origLog = console.log;
    console.log = (msg?: unknown): void => {
      if (typeof msg === 'string' && msg.includes('tick_dropped_backpressure')) {
        droppedLines.push(msg);
      }
      origLog.call(console, msg);
    };

    try {
      const dispatcher = new OutboxDispatcherWorker({
        db: db as unknown as PostgresJsDatabase<typeof schema>,
        consumer: async () => {
          await consumerHolding;
        },
        pollIntervalMs: 60_000,
        maxAttempts: 3,
        maxPendingTicks: 2,
      });
      activeDispatcher = dispatcher;

      // First tick — runs immediately, hangs on consumerHolding.
      const t1 = dispatcher.tick();
      // The next 2 calls fill the pending queue (within the cap).
      const t2 = dispatcher.tick();
      const t3 = dispatcher.tick();
      // The 4th call is past the cap → dropped, returns a zero result.
      const t4 = await dispatcher.tick();
      expect(t4.claimed).toBe(0);
      expect(droppedLines.length).toBeGreaterThanOrEqual(1);

      // Unblock so the suite can tear down cleanly.
      releaseConsumer();
      await Promise.all([t1, t2, t3]);
    } finally {
      console.log = origLog;
    }
  });

  it('routes tick failures to the observer port (D159)', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;

    const captured: Array<{ error: unknown; context: BackgroundFailureContext }> = [];
    const observer: OutboxObserver = {
      captureBackgroundFailure: (error, context) => {
        captured.push({ error, context });
      },
    };

    // Close the underlying PGlite so the dispatcher's tx throws.
    await pg.close();
    activePg = null;

    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: async () => undefined,
      pollIntervalMs: 60_000,
      observer,
    });
    activeDispatcher = null; // can't stop — pg is already closed
    await dispatcher.tick();

    expect(captured.length).toBeGreaterThanOrEqual(1);
    // `worker` rides under `tags` — a sibling of `kind` is silently
    // dropped by the production adapter (`BackgroundFailureContext` has
    // no such field). See `reportConsumerFailure`'s regression test below.
    expect(captured[0]?.context).toMatchObject({
      kind: 'outbox.dispatch.tick_failed',
      tags: { worker: 'OutboxDispatcherWorker' },
    });
  });

  it('stop() drains an in-flight tick and unsubscribes the listener', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;

    let releaseConsumer!: () => void;
    const consumerStarted = new Promise<void>((r) => {
      releaseConsumer = r;
    });
    let resumeConsumer!: () => void;
    const consumerResumes = new Promise<void>((r) => {
      resumeConsumer = r;
    });

    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'sync.history_processed',
        aggregateId: 'drain-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    const dispatcher = makeDispatcher(
      db,
      async () => {
        releaseConsumer();
        await consumerResumes;
      },
      { pg, pollIntervalMs: 60_000 },
    );
    activeDispatcher = dispatcher;

    // Kick off start(); the consumer will block until we release it.
    const startP = dispatcher.start();
    await consumerStarted; // tick is mid-consumer
    const stopP = dispatcher.stop();
    // Stop must NOT race ahead of the in-flight tick; release the
    // consumer and await start() then stop().
    resumeConsumer();
    await startP;
    await stopP;

    // Row should have been dispatched (consumer completed during drain).
    const rows = await db.select().from(outboxEvents);
    expect(rows[0]?.status).toBe('dispatched');
  });

  /**
   * CLAUDE.md §2.6. A consumer's BullMQ publish can hang forever during
   * a Redis outage (ioredis buffers commands rather than rejecting them
   * — see `queue.ts`). Without a bound, the awaited consumer call never
   * returns, the open claim transaction never commits, and — because
   * ticks coalesce via `inFlight` — EVERY later tick piles up behind
   * this one stuck tick instead of just the affected topic.
   *
   * This also covers the fix for a regression a pre-merge review found
   * in an earlier version of this same change: treating a timeout like
   * any other consumer failure let `maxAttempts` retries burn through in
   * a couple of minutes during a real outage and permanently flip the
   * row to `failed` — sometimes AFTER the abandoned call had actually
   * succeeded. `maxAttempts` is set to 3 below specifically so that, if
   * that regression reappeared, 3 ticks would be enough to reproduce it.
   *
   * NEGATIVE CONTROL: reverting `withConsumerTimeout` (i.e. calling
   * `this.deps.consumer(event)` directly, as the code did before this
   * fix existed at all) makes this test hang until vitest's own 30s
   * per-test timeout fires and fails it — it does NOT pass vacuously.
   */
  it('bounds a hung consumer call and never permanently fails it across a sustained outage', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'hang-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    // Never resolves/rejects — models a BullMQ `.add()` awaiting a Redis
    // reply that will never come while the connection is down.
    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: () => new Promise<void>(() => undefined),
      pollIntervalMs: 60_000,
      maxAttempts: 3,
      consumerTimeoutMs: 50,
    });
    activeDispatcher = dispatcher;

    const startedAt = Date.now();
    const result = await dispatcher.tick();
    const elapsedMs = Date.now() - startedAt;

    // Bounded by consumerTimeoutMs, not by the (never-arriving) consumer
    // settlement — generous slack for CI scheduling jitter, still far
    // below vitest's 30s test timeout that a true hang would hit.
    expect(elapsedMs).toBeLessThan(2_000);
    // skippedOrphaned is a snapshot of orphanedEvents.size at the END of
    // the tick, including an orphan THIS tick just created — the row was
    // still claimed and genuinely attempted (claimed: 1), but by the time
    // this result is read the timeout has already registered the orphan.
    expect(result).toEqual({
      claimed: 1,
      dispatched: 0,
      consumerFailed: 1,
      consumerTimedOut: 1,
      flippedToFailed: 0,
      skippedOrphaned: 1,
    });

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain('exceeded 50ms');

    // Many more ticks than maxAttempts (3): the event's (topic,
    // aggregateId) is now orphan-guarded, so every one of these is a
    // fast no-op — the claim query itself excludes it (never even
    // `claimed`), and the row is left completely untouched, never
    // re-bumped, never re-claimed-and-retried, because the original
    // abandoned call is still "running" (it never settles in this
    // test).
    for (let i = 0; i < 5; i += 1) {
      const tickStartedAt = Date.now();
      const later = await dispatcher.tick();
      expect(Date.now() - tickStartedAt).toBeLessThan(2_000);
      expect(later).toEqual({
        claimed: 0,
        dispatched: 0,
        consumerFailed: 0,
        consumerTimedOut: 0,
        flippedToFailed: 0,
        skippedOrphaned: 1,
      });
    }

    // Never flipped to failed, and attempts never moved past the single
    // real timeout — despite 6 total ticks against a maxAttempts of 3.
    const [rowAfterMany] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(rowAfterMany?.status).toBe('pending');
    expect(rowAfterMany?.attempts).toBe(1);
  });

  /**
   * The test above (a consumer that never settles at all) is guarded
   * against `maxAttempts` two different ways at once: the timeout
   * exemption in `runOneTick`'s catch block, AND the orphan guard, which
   * never lets `attempts` bump again while that one abandoned call is
   * still outstanding. This test isolates JUST the timeout exemption, by
   * using a consumer that is genuinely slow — always past
   * `consumerTimeoutMs` — but NOT stuck: it settles a bit later every
   * time, so the orphan clears and a fresh, real, sequential invocation
   * happens again and again, each one ALSO timing out. That drives
   * `attempts` past `maxAttempts` through repeated REAL timeouts, not a
   * single permanently-orphaned one — and the row must still never
   * reach `failed`.
   *
   * NEGATIVE CONTROL: removing `!isTimeout` from `runOneTick`'s
   * `shouldFail` computation (restoring `shouldFail = nextAttempts >=
   * this.maxAttempts`) makes this test fail — the row flips to `failed`
   * once real attempts exceed `maxAttempts` — confirmed while developing
   * this fix (the orphan guard alone does not save this scenario, since
   * each attempt here genuinely completes and clears before the next).
   */
  it('a genuinely slow (not stuck) consumer that always exceeds the timeout is still never permanently failed', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'slow-not-stuck-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    // Each invocation's resolution is under this test's explicit
    // control (rather than racing a second real timer against
    // consumerTimeoutMs, which is flaky under system load) — the ONLY
    // real timer in play per cycle is the dispatcher's own
    // consumerTimeoutMs deadline, which is the thing actually under
    // test.
    let totalInvocations = 0;
    const resolvers: Array<() => void> = [];
    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: () =>
        new Promise<void>((resolve) => {
          totalInvocations += 1;
          resolvers.push(resolve);
        }),
      pollIntervalMs: 60_000,
      maxAttempts: 3,
      consumerTimeoutMs: 20,
    });
    activeDispatcher = dispatcher;

    const consumerTimedOutSeen: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      // Times out at 20ms — the consumer call captured above is still
      // pending. Each iteration is a FRESH real invocation because the
      // previous one was explicitly resolved (and its orphan cleared)
      // at the end of the prior iteration.
      const result = await dispatcher.tick();
      consumerTimedOutSeen.push(result.consumerTimedOut);

      // Resolve THIS attempt's call now that the dispatcher has already
      // given up on it — models a downstream that is slow but not
      // stuck. Then flush the microtask that clears the orphan entry
      // before the next iteration's tick() runs.
      resolvers[i]?.();
      await new Promise((r) => setTimeout(r, 5));
    }

    // Every one of the 6 ticks was a real, fresh timeout — never a
    // skipped orphan — proving these were 6 SEQUENTIAL real attempts,
    // not one stuck one.
    expect(totalInvocations).toBe(6);
    expect(consumerTimedOutSeen).toEqual([1, 1, 1, 1, 1, 1]);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('pending'); // never failed, despite attempts > maxAttempts (3)
    expect(row?.attempts).toBe(6);
    expect(row?.lastError).toContain('exceeded 20ms');
  });

  /**
   * Architecture-guardian review, 2026-09-28: an earlier version of this
   * fix let a retry run the SAME event's consumer concurrently with its
   * own abandoned (timed-out) attempt. That's safe for a simple
   * jobId-keyed BullMQ `.add()`, but NOT safe for a multi-step
   * read-modify-write like `enqueueEmailSend`'s reap-and-replace path,
   * which has a real interleaving that sends a duplicate email. This
   * test proves the dispatcher never invokes an event's consumer a
   * second time while the first call is still outstanding.
   *
   * NEGATIVE CONTROL: with the orphan guard removed (i.e. skip the
   * `orphanedEvents` check in `runOneTick` and call
   * `withConsumerTimeout` directly, as the very first version of this
   * fix did), `maxConcurrentSeen` below goes to 2 instead of staying at
   * 1 — confirmed while developing this fix.
   */
  it('never invokes the same event consumer concurrently with its own orphaned attempt', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'concurrent-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    let concurrentCount = 0;
    let maxConcurrentSeen = 0;
    let totalInvocations = 0;
    let releaseFirstCall!: () => void;
    const firstCallGate = new Promise<void>((r) => {
      releaseFirstCall = r;
    });

    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: async () => {
        totalInvocations += 1;
        concurrentCount += 1;
        maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentCount);
        try {
          await firstCallGate; // already-resolved on the 2nd+ invocation
        } finally {
          concurrentCount -= 1;
        }
      },
      pollIntervalMs: 60_000,
      maxAttempts: 5,
      consumerTimeoutMs: 30,
    });
    activeDispatcher = dispatcher;

    // Tick 1: invokes the consumer for real (1st entry); times out at
    // 30ms while the call is still blocked on firstCallGate — that call
    // is now an orphan, still genuinely running.
    const first = await dispatcher.tick();
    expect(first.consumerTimedOut).toBe(1);
    expect(totalInvocations).toBe(1);

    // Ticks 2 and 3: the event's (topic, aggregateId) is orphan-guarded
    // — the claim query itself excludes it, so these must NOT even claim
    // the row, let alone re-invoke the consumer while the first call is
    // still outstanding.
    const second = await dispatcher.tick();
    const third = await dispatcher.tick();
    expect(second).toMatchObject({ claimed: 0, skippedOrphaned: 1 });
    expect(third).toMatchObject({ claimed: 0, skippedOrphaned: 1 });
    expect(totalInvocations).toBe(1); // still only the one real entry
    expect(maxConcurrentSeen).toBe(1); // never ran twice at once

    // Release the original call and let its `.then()` clear the orphan
    // tracking (a microtask — flush it before the next tick).
    releaseFirstCall();
    await new Promise((r) => setTimeout(r, 10));

    // Now a fresh, SEQUENTIAL second invocation is allowed — this is
    // exactly the "later redelivery" every consumer is already required
    // to tolerate, never a concurrent one.
    const fourth = await dispatcher.tick();
    expect(fourth).toEqual({
      claimed: 1,
      dispatched: 1,
      consumerFailed: 0,
      consumerTimedOut: 0,
      flippedToFailed: 0,
      skippedOrphaned: 0,
    });
    expect(totalInvocations).toBe(2);
    expect(maxConcurrentSeen).toBe(1);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('dispatched');
  });

  /**
   * BLOCKING finding (architecture-guardian, 2026-09-29): the orphan
   * guard above proves the SAME event is never invoked concurrently
   * with itself, but it was keyed on `event.id` — which does nothing
   * for two DIFFERENT outbox events that share the same downstream
   * concurrency unit. `mailbox.sync_ready`'s reminder email is keyed by
   * mailbox alone (`syncReminderEmailJobId`), and a sync retry after a
   * crash re-publishes a FRESH `mailbox.sync_ready` event (new id, same
   * `firstReady: true`) for the same mailbox — reproducing the exact
   * duplicate-send race the same-event guard above already closed, one
   * key over.
   *
   * Both events are published BEFORE the first tick runs, so SKIP
   * LOCKED claims them TOGETHER in one batch (`ORDER BY created_at`)
   * and processes them one at a time, in the SAME transaction. That is
   * the scenario that actually exercises the KEY CHOICE: the claim
   * SQL's own orphan exclusion (built from the map's STORED topic/
   * aggregateId fields, populated directly from each orphaned event
   * regardless of the map's key) already protects the cross-TICK case
   * either way — it is the WITHIN-tick guard, checked via
   * `orphanGuardKey`, that only catches the second row here if the key
   * is (topic, aggregateId) rather than `event.id`.
   *
   * This proves the second, DIFFERENT event is never invoked while the
   * first's orphaned call — created moments earlier by an EARLIER row
   * in this SAME batch — is still outstanding, and that both eventually
   * run, sequentially, never concurrently, once it clears.
   *
   * NEGATIVE CONTROL: keying `orphanGuardKey` by `event.id` instead of
   * `(event.topic, event.aggregateId)` makes this test fail — the
   * second (different-id) event is ALSO invoked and ALSO times out
   * within the SAME tick (`consumerTimedOut: 2`, not `1`), proving its
   * consumer ran concurrently with the first's still-outstanding
   * orphaned call — confirmed while
   * developing this fix.
   */
  it('never invokes a DIFFERENT event sharing the same (topic, aggregateId) concurrently with an orphan', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();
    let firstId = '';
    let secondId = '';
    // Both published BEFORE any tick, so they are claimed TOGETHER in
    // one batch — see the docstring above for why that matters.
    await db.transaction(async (tx) => {
      firstId = await publisher.publish(tx, {
        topic: 'mailbox.sync_ready',
        aggregateId: 'shared-mailbox-1',
        payload: {},
        schema: EmptyPayload,
      });
    });
    await db.transaction(async (tx) => {
      secondId = await publisher.publish(tx, {
        topic: 'mailbox.sync_ready',
        aggregateId: 'shared-mailbox-1',
        payload: {},
        schema: EmptyPayload,
      });
    });
    expect(secondId).not.toBe(firstId);

    let concurrentCount = 0;
    let maxConcurrentSeen = 0;
    const invokedEventIds: string[] = [];
    let releaseFirstCall!: () => void;
    const firstCallGate = new Promise<void>((r) => {
      releaseFirstCall = r;
    });

    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: async (event) => {
        invokedEventIds.push(event.id);
        concurrentCount += 1;
        maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentCount);
        try {
          await firstCallGate; // already-resolved by the time either row is retried
        } finally {
          concurrentCount -= 1;
        }
      },
      pollIntervalMs: 60_000,
      maxAttempts: 5,
      consumerTimeoutMs: 30,
    });
    activeDispatcher = dispatcher;

    // Tick 1 claims BOTH rows in one batch (`claimed: 2`) and processes
    // them one at a time. firstId (older) runs first: it hangs on
    // firstCallGate and times out at 30ms, becoming an orphan keyed by
    // (topic, aggregateId) — still genuinely running. secondId — a
    // LATER row in this SAME batch, sharing that same key — must then
    // be left completely untouched by the in-loop guard, never invoked
    // at all this tick.
    const first = await dispatcher.tick();
    expect(first).toMatchObject({ claimed: 2, consumerTimedOut: 1, skippedOrphaned: 1 });
    expect(invokedEventIds).toEqual([firstId]); // second event never invoked this tick
    expect(maxConcurrentSeen).toBe(1); // never ran twice at once

    // Ticks 2 and 3: the SHARED (topic, aggregateId) is still
    // orphan-guarded — the claim query excludes BOTH rows entirely, so
    // the second (different) event is still never claimed, let alone
    // invoked concurrently with the first's still-outstanding call.
    const second = await dispatcher.tick();
    const third = await dispatcher.tick();
    expect(second).toMatchObject({ claimed: 0, skippedOrphaned: 1 });
    expect(third).toMatchObject({ claimed: 0, skippedOrphaned: 1 });
    expect(invokedEventIds).toEqual([firstId]); // still never invoked
    expect(maxConcurrentSeen).toBe(1); // never ran twice at once

    // Release the original call and let its `.then()` clear the orphan
    // tracking (a microtask — flush it before the next tick).
    releaseFirstCall();
    await new Promise((r) => setTimeout(r, 10));

    // Now both rows are free to run — the original (a legitimate later
    // retry, since its abandoned attempt never reported success) and
    // the second, different event. Whether one or two ticks are needed
    // is an implementation detail of claim-batch ordering; what matters
    // is they never run concurrently with EACH OTHER either.
    for (let i = 0; i < 4; i += 1) {
      const [firstRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, firstId));
      const [secondRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, secondId));
      if (firstRow?.status === 'dispatched' && secondRow?.status === 'dispatched') break;
      await dispatcher.tick();
    }

    const [firstRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, firstId));
    const [secondRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, secondId));
    expect(firstRow?.status).toBe('dispatched');
    expect(secondRow?.status).toBe('dispatched');
    expect(maxConcurrentSeen).toBe(1); // never ran twice at once, even across both events
  });

  /**
   * Non-blocking finding (architecture-guardian, 2026-09-29), but a real
   * livelock during a sustained outage: an orphaned row's `created_at`
   * and `attempts` never change while it is orphan-guarded, so it sorts
   * at the SAME position in the claim query's `ORDER BY created_at`
   * FOREVER. A claim-then-skip design (claim `claimBatchSize` rows, skip
   * the orphaned ones in the loop) still spends one of that tick's
   * claim slots on it every single tick — once the count of distinct
   * orphaned keys reaches `claimBatchSize`, no OTHER row is ever claimed
   * again, for any topic. This proves a genuinely-processable, NEWER
   * row behind an orphaned one is still claimed and dispatched, using a
   * `claimBatchSize` of 1 — the tightest possible budget, so the fix
   * cannot hide behind a generous LIMIT.
   *
   * NEGATIVE CONTROL: reverting the claim SQL to the pre-fix
   * claim-then-skip shape (removing the `orphanExclusion` fragment and
   * restoring the per-row `if (this.orphanedEvents.has(...)) { continue
   * }` as the ONLY guard) makes this test fail — the second tick claims
   * the STUCK row again (oldest by `created_at`, `claimBatchSize: 1`
   * admits exactly one row), skips it, and the fresh row is never
   * claimed at all — confirmed while developing this fix.
   */
  it('an orphaned key does not starve a different, newer row behind it in FIFO order', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    const publisher = new OutboxPublisher();
    let stuckId = '';
    await db.transaction(async (tx) => {
      stuckId = await publisher.publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'stuck-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: async (event) => {
        if (event.aggregateId === 'stuck-1') {
          return new Promise<void>(() => undefined); // never settles
        }
        // Every other event dispatches immediately.
      },
      pollIntervalMs: 60_000,
      claimBatchSize: 1,
      consumerTimeoutMs: 30,
    });
    activeDispatcher = dispatcher;

    // Tick 1: claims and times out the stuck row — it is now orphaned.
    const first = await dispatcher.tick();
    expect(first).toMatchObject({ claimed: 1, consumerTimedOut: 1 });

    // A NEWER, unrelated event arrives after the stuck one.
    let freshId = '';
    await db.transaction(async (tx) => {
      freshId = await publisher.publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'fresh-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    // claimBatchSize is 1 — a claim-then-skip design would spend this
    // tick's ONLY slot re-claiming the orphaned row (oldest by
    // created_at) and never reach the fresh one. Excluding it at the
    // SQL level lets SKIP LOCKED's plan move past it to the fresh row
    // within the same LIMIT.
    const second = await dispatcher.tick();
    expect(second).toMatchObject({ claimed: 1, dispatched: 1, skippedOrphaned: 1 });

    const [freshRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, freshId));
    expect(freshRow?.status).toBe('dispatched');
    const [stuckRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, stuckId));
    expect(stuckRow?.status).toBe('pending'); // still stuck, untouched, never re-claimed
  });

  /**
   * Also-fix finding (architecture-guardian, 2026-09-29): the timeout
   * exemption from `maxAttempts` had no end state — a row whose OWN
   * streak of timeouts never breaks would retry forever with no Sentry
   * signal, indistinguishable in logs from a healthy skip (CLAUDE.md's
   * "a guard that cannot fail is not a guard"). `maxAttempts` is set
   * absurdly high here so ONLY `timeoutStuckCeilingMs` can explain a
   * `failed` row. Each attempt settles a bit later than the next tick's
   * claim (never permanently orphaned), so the streak accumulates across
   * repeated, genuinely-real timeouts — matching the "genuinely slow
   * (not stuck) consumer" test's shape, the realistic way a row stays
   * stuck in production (a truly-eternal single hang cannot re-trigger
   * this check at all, since the orphan guard never lets it be
   * reclaimed to try again).
   *
   * NEGATIVE CONTROL: removing the `timeoutStreakExceededCeiling` half
   * of `shouldFail` (restoring `shouldFail = !isTimeout && nextAttempts
   * >= this.maxAttempts`) makes this test fail — with `maxAttempts` this
   * high, the row never reaches `failed` and `captured` stays empty —
   * confirmed while developing this fix.
   */
  it('a timeout streak that outlives timeoutStuckCeilingMs eventually fails and reports to the observer', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'ceiling-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    const captured: unknown[] = [];
    const resolvers: Array<() => void> = [];
    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve); // each invocation is a FRESH, eventually-resolved promise
        }),
      pollIntervalMs: 60_000,
      maxAttempts: 1_000, // effectively disabled — only the ceiling can fail this row
      consumerTimeoutMs: 10,
      timeoutStuckCeilingMs: 25,
      observer: {
        captureBackgroundFailure: (error) => {
          captured.push(error);
        },
      },
    });
    activeDispatcher = dispatcher;

    let flippedToFailed = false;
    for (let i = 0; i < 20 && !flippedToFailed; i += 1) {
      const result = await dispatcher.tick();
      flippedToFailed = result.flippedToFailed > 0;
      // Resolve THIS attempt's call so the orphan clears before the next
      // tick — a genuinely repeated failure, not one stuck-forever call.
      resolvers[i]?.();
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(flippedToFailed).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBeInstanceOf(OutboxConsumerTimeoutError);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('failed');
  });

  /**
   * Also-fix finding (architecture-guardian, 2026-09-29): classifying a
   * timeout by `err.name === 'TimeoutError'` is fragile — ANY error
   * happening to carry that name gets the SAME exemption forever,
   * including a real HTTP timeout from this codebase's own Gmail/BIMI/
   * billing clients (`gmail-client.service.ts`, `bimi-resolver.ts`,
   * `paddle.adapter.ts`, `razorpay.adapter.ts`), which already throw a
   * native `TimeoutError`-named `DOMException` from
   * `AbortSignal.timeout()`. This proves a same-named-but-foreign error
   * is treated as an ORDINARY failure — it counts toward `maxAttempts`
   * and can flip the row to `failed`, exactly like any other real bug,
   * never silently exempted forever.
   *
   * NEGATIVE CONTROL: reverting `isOutboxTimeoutError` to `err
   * instanceof Error && err.name === 'TimeoutError'` makes this test
   * fail — the foreign error is misclassified as a timeout
   * (`consumerTimedOut: 1`, not `0`), which exempts it from
   * `maxAttempts` — confirmed while developing this fix.
   */
  it('a same-named but foreign TimeoutError does not get the timeout exemption (classification is by identity, not by .name)', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'foreign-timeout-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    const foreignTimeoutError = new Error('The operation was aborted due to timeout');
    foreignTimeoutError.name = 'TimeoutError'; // matches AbortSignal.timeout()'s DOMException.name

    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: async () => {
        throw foreignTimeoutError;
      },
      pollIntervalMs: 60_000,
      maxAttempts: 2,
      consumerTimeoutMs: 5_000, // generous — this consumer throws immediately, it never times out
    });
    activeDispatcher = dispatcher;

    const first = await dispatcher.tick();
    expect(first).toMatchObject({ consumerFailed: 1, consumerTimedOut: 0, flippedToFailed: 0 });

    const second = await dispatcher.tick();
    expect(second).toMatchObject({ consumerFailed: 1, consumerTimedOut: 0, flippedToFailed: 1 });

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('failed'); // never exempted — a real bug fails normally
  });

  it('logs (never throws) when a timed-out consumer call finally resolves', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'late-settle-resolve-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    let resolveConsumer!: () => void;
    const consumerSettles = new Promise<void>((r) => {
      resolveConsumer = r;
    });

    const warnLines: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg?: unknown): void => {
      if (typeof msg === 'string' && msg.includes('consumer_settled_after_timeout')) {
        warnLines.push(msg);
      }
      origWarn.call(console, msg);
    };

    try {
      const dispatcher = new OutboxDispatcherWorker({
        db: db as unknown as PostgresJsDatabase<typeof schema>,
        consumer: () => consumerSettles,
        pollIntervalMs: 60_000,
        consumerTimeoutMs: 20,
      });
      activeDispatcher = dispatcher;

      // Times out at 20ms — the consumer promise is still unsettled.
      const result = await dispatcher.tick();
      expect(result.consumerTimedOut).toBe(1);
      expect(warnLines).toHaveLength(0);

      // The orphaned call finally resolves (Redis reconnected). It can no
      // longer affect the tick's outcome, but it must not vanish silently
      // or surface as an unhandled rejection — it should be logged.
      resolveConsumer();
      await new Promise((r) => setTimeout(r, 25));

      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toContain('"outcome":"resolved"');
      expect(warnLines[0]).toContain('"kind":"outbox.dispatch.consumer_settled_after_timeout"');
    } finally {
      console.warn = origWarn;
    }
  });

  /**
   * NIT from the pre-merge review: only the resolve-after-timeout branch
   * was covered. The reject-after-timeout branch is the more dangerous
   * one — it is where dropping the rejection handler would turn an
   * orphan's failure into an unhandled rejection (Node's default setting
   * crashes the whole process on one). This test fails loudly (an
   * uncaught/unhandled rejection fails the vitest run) if that handler
   * is ever removed.
   */
  it('logs (never throws) when a timed-out consumer call finally rejects', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    await db.transaction(async (tx) => {
      await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'late-settle-reject-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    let rejectConsumer!: (err: Error) => void;
    const consumerSettles = new Promise<void>((_resolve, reject) => {
      rejectConsumer = reject;
    });

    const warnLines: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg?: unknown): void => {
      if (typeof msg === 'string' && msg.includes('consumer_settled_after_timeout')) {
        warnLines.push(msg);
      }
      origWarn.call(console, msg);
    };

    try {
      const dispatcher = new OutboxDispatcherWorker({
        db: db as unknown as PostgresJsDatabase<typeof schema>,
        consumer: () => consumerSettles,
        pollIntervalMs: 60_000,
        consumerTimeoutMs: 20,
      });
      activeDispatcher = dispatcher;

      const result = await dispatcher.tick();
      expect(result.consumerTimedOut).toBe(1);

      rejectConsumer(new Error('downstream finally answered: still broken'));
      await new Promise((r) => setTimeout(r, 25));

      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toContain('"outcome":"rejected"');
      // errorName only — never the raw message (#807's convention for
      // this exact file/failure class: a Drizzle query error's message
      // can carry bound query parameters). The message text must be
      // ABSENT, not merely uninspected.
      expect(warnLines[0]).toContain('"errorName":"Error"');
      expect(warnLines[0]).not.toContain('downstream finally answered');
    } finally {
      console.warn = origWarn;
    }
  });

  /**
   * Pre-merge review (silent-failure-hunter + architecture-guardian,
   * 2026-09-28): `String(err)` can itself throw (a null-prototype
   * rejection value has no `toString`). That used to run AFTER `settled
   * = true; clearTimeout(timer)`, so the throw left `withConsumerTimeout`
   * stuck pending forever — the exact bug this whole fix exists to
   * prevent, reintroduced through a different door.
   *
   * NEGATIVE CONTROL: reordering the fix back to compute `settled`/clear
   * the timer BEFORE the safe-string conversion reproduces the hang —
   * confirmed while developing this fix; this test would then time out
   * at vitest's 30s limit instead of completing.
   */
  it('does not hang when an abandoned call rejects with a value that cannot be stringified', async () => {
    const { db, pg } = await freshDb();
    activePg = pg;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'unstringifiable-1',
        payload: {},
        schema: EmptyPayload,
      });
    });

    let rejectConsumer!: (err: unknown) => void;
    const consumerSettles = new Promise<void>((_resolve, reject) => {
      rejectConsumer = reject;
    });

    const dispatcher = new OutboxDispatcherWorker({
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      consumer: () => consumerSettles,
      pollIntervalMs: 60_000,
      consumerTimeoutMs: 20,
    });
    activeDispatcher = dispatcher;

    const result = await dispatcher.tick();
    expect(result.consumerTimedOut).toBe(1);

    // A null-prototype object has no `toString`/`valueOf` — `String()`
    // on it throws `TypeError: Cannot convert object to primitive value`.
    const unstringifiable = Object.create(null) as unknown;
    const startedAt = Date.now();
    rejectConsumer(unstringifiable);
    await new Promise((r) => setTimeout(r, 25));
    expect(Date.now() - startedAt).toBeLessThan(2_000);

    // The dispatcher survived (no unhandled rejection killed the
    // process, no hang) and keeps working — the strongest proof
    // available from inside a single vitest process. The mock consumer
    // reuses the same (now-rejected) promise, so this reclaim rejects
    // immediately rather than timing out again — exercising the SAME
    // safe-string path from the main (non-late) reject branch too.
    const anotherStartedAt = Date.now();
    const another = await dispatcher.tick();
    expect(Date.now() - anotherStartedAt).toBeLessThan(2_000);
    expect(another).toEqual({
      claimed: 1,
      dispatched: 0,
      consumerFailed: 1,
      consumerTimedOut: 0,
      flippedToFailed: 0,
      skippedOrphaned: 0,
    });

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(2);
    expect(row?.lastError).toBe('Error: unstringifiable rejection value');
  });
});

/**
 * SKIP LOCKED concurrency — runtime proof against real Postgres.
 *
 * The in-suite `claim query includes FOR UPDATE SKIP LOCKED` test
 * asserts the SQL string Drizzle emits. Proving that two concurrent
 * transactions actually grab DISJOINT row sets requires multiple
 * connections to a real Postgres — PGlite is single-connection in-
 * process and cannot model that.
 *
 * This describe.skipIf block runs only when `OUTBOX_TEST_PG_URL` is
 * set (e.g. in CI against a real Postgres or via a local dev pg, see
 * FOUNDER-FOLLOWUPS 2026-05-23 entry). It spawns two `runOneTick`
 * calls against the same DB concurrently and asserts the claimed-row-id
 * sets are disjoint and together cover the seeded rows.
 *
 * Why a separate describe rather than inlining a `skipIf` per-test?
 * Keeps the PGlite-only fixtures (`freshDb` above) clearly separate
 * from the real-Postgres fixture (`freshRealDb` below). Future
 * real-PG-only tests slot in here.
 */
describe.skipIf(!process.env.OUTBOX_TEST_PG_URL)(
  'OutboxDispatcherWorker against real Postgres',
  () => {
    it('SKIP LOCKED — two concurrent ticks claim disjoint row sets', async () => {
      // Intentional dynamic import: `postgres` is NOT a workspace
      // dependency of @declutrmail/workers (the prod runtime uses the
      // postgres-js client passed in by the composition root). Loading
      // it here keeps the dep optional for the PGlite-only test path.
      // Dynamic imports (kept dynamic so the PGlite-only test path
      // does not need `postgres` installed at workspace level). The
      // `as never` cast is a narrow workaround for ESLint's
      // `consistent-type-imports` rule which forbids `typeof import(…)`
      // type annotations inline — we instead trust the runtime shape.
      const { default: postgres } = (await import('postgres' as string).catch(() => {
        throw new Error(
          'OUTBOX_TEST_PG_URL is set but the `postgres` package is not installed. ' +
            'Install it as a devDependency or unset OUTBOX_TEST_PG_URL.',
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as { default: (url: string, opts?: any) => any };
      const { drizzle: drizzlePg } = (await import(
        'drizzle-orm/postgres-js' as string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as { drizzle: (client: any, opts?: any) => any };

      const pgUrl = process.env.OUTBOX_TEST_PG_URL!;
      // `OUTBOX_TEST_PG_URL` must point at a DISPOSABLE, EMPTY database
      // — CI hands this job its own throwaway Postgres service, and
      // locally it is one `createdb`. The migrations are applied to it
      // whole and nothing is torn down.
      //
      // This used to create an isolated schema and `SET search_path` to
      // it, which cannot work and was never once executed to find out.
      // The first run, on 2026-08-11, failed with `type
      // "mailbox_provider" does not exist`: every migration writes
      // `CREATE TYPE "public"."<enum>"` — schema-qualified to public —
      // while the tables that use it reference the type UNQUALIFIED
      // (`packages/db/migrations/0000_…sql:2,9`). Under a redirected
      // search_path the type is created in `public` and then looked up
      // in the isolated schema, so table creation fails on the very
      // first migration. Schema isolation is not compatible with these
      // migrations; a separate database is.
      const client = postgres(pgUrl, { max: 4 });
      const realDb = drizzlePg(client, { schema }) as PostgresJsDatabase<typeof schema>;

      try {
        const files = readdirSync(MIGRATIONS_DIR)
          .filter((f) => f.endsWith('.sql'))
          .sort();
        for (const file of files) {
          const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
          for (const stmt of sqlText.split('--> statement-breakpoint')) {
            const trimmed = stmt.trim();
            if (trimmed) await client.unsafe(trimmed);
          }
        }

        // Seed 20 pending rows so two batches of 10 are disjoint.
        const seededIds: string[] = [];
        for (let i = 0; i < 20; i += 1) {
          const id = await realDb.transaction(async (tx) =>
            new OutboxPublisher().publish(tx, {
              topic: 'sync.history_processed',
              aggregateId: `seed-${i}`,
              payload: {},
              schema: EmptyPayload,
            }),
          );
          seededIds.push(id);
        }

        // Two dispatchers, each claims up to 10, against the same DB.
        //
        // The overlap is FORCED, not hoped for. `Promise.all([a.tick(),
        // b.tick()])` only *usually* interleaves: if A's transaction
        // happens to commit before B's SELECT reaches the server, B
        // simply finds the remaining 10 rows pending and every
        // assertion below passes having exercised nothing. That is a
        // vacuous pass — the same shape as the guards this test was
        // wired up to replace — and no amount of re-running detects it,
        // because the vacuous path and the real path are both green.
        //
        // Instead: A's consumer runs INSIDE A's claim transaction (see
        // `runOneTick` — the SELECT ... FOR UPDATE and the per-row
        // UPDATEs share one transaction), so pausing there parks A
        // holding row locks on its 10 rows, uncommitted. B then runs
        // against a table where 10 rows are provably locked. There is
        // no interleaving left to chance.
        const claimedA: string[] = [];
        const claimedB: string[] = [];

        let signalAClaimed!: () => void;
        const aHasClaimed = new Promise<void>((resolve) => {
          signalAClaimed = resolve;
        });
        let releaseA!: () => void;
        const aMayCommit = new Promise<void>((resolve) => {
          releaseA = resolve;
        });

        const dispatchA = new OutboxDispatcherWorker({
          db: realDb,
          consumer: async (e) => {
            claimedA.push(e.id);
            // First row only: the claim SELECT has already run, so every
            // row A will take is locked as of now.
            if (claimedA.length === 1) {
              signalAClaimed();
              await aMayCommit;
            }
          },
          claimBatchSize: 10,
          pollIntervalMs: 60_000,
        });
        const dispatchB = new OutboxDispatcherWorker({
          db: realDb,
          consumer: async (e) => {
            claimedB.push(e.id);
          },
          claimBatchSize: 10,
          pollIntervalMs: 60_000,
        });

        const aTick = dispatchA.tick();
        await aHasClaimed;

        // B must finish WHILE A holds the locks. With SKIP LOCKED it
        // steps over A's rows and takes the other 10. Without it, `FOR
        // UPDATE` blocks on A's locks and B never returns — so the
        // timeout is not flake protection, it IS the negative result,
        // and it must fail loudly rather than hang the suite.
        await Promise.race([
          dispatchB.tick(),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'dispatcher B did not finish while A held its claim — the claim query blocked ' +
                      'instead of skipping locked rows (FOR UPDATE without SKIP LOCKED behaves ' +
                      'exactly this way)',
                  ),
                ),
              10_000,
            ),
          ),
        ]);

        releaseA();
        await aTick;

        // Disjoint claims + together cover the seed.
        const setA = new Set(claimedA);
        const setB = new Set(claimedB);
        for (const id of setA) {
          expect(setB.has(id)).toBe(false);
        }
        expect(setA.size + setB.size).toBe(seededIds.length);
      } finally {
        await client.end({ timeout: 5 });
      }
    });
  },
);
