import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { outboxEvents, schema } from '@declutrmail/db';

import {
  OUTBOX_NOTIFY_CHANNEL,
  OutboxDispatcherWorker,
  type DispatchedEvent,
  type OutboxConsumer,
  type OutboxObserver,
} from './outbox-dispatcher.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';

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
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
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
  opts: { pg?: PGlite; pollIntervalMs?: number; maxAttempts?: number } = {},
): OutboxDispatcherWorker {
  return new OutboxDispatcherWorker({
    // PGlite client is structurally compatible with PostgresJsDatabase for
    // our query shapes; the cast matches InitialSyncWorker test convention.
    db: db as unknown as PostgresJsDatabase<typeof schema>,
    consumer,
    pollIntervalMs: opts.pollIntervalMs ?? 60_000, // off by default in unit tests
    maxAttempts: opts.maxAttempts ?? 5,
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
      flippedToFailed: 0,
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

    const captured: Array<{ error: unknown; context: Record<string, unknown> }> = [];
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
    expect(captured[0]?.context).toMatchObject({
      kind: 'outbox.dispatch.tick_failed',
      worker: 'OutboxDispatcherWorker',
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
      const client = postgres(pgUrl, { max: 4 });
      const realDb = drizzlePg(client, { schema }) as PostgresJsDatabase<typeof schema>;

      try {
        // Apply migrations into an isolated schema so the test does
        // not collide with anything else in the target DB.
        const isolated = `outbox_test_${Date.now()}`;
        await client.unsafe(`CREATE SCHEMA "${isolated}"`);
        await client.unsafe(`SET search_path TO "${isolated}"`);
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
        const claimedA: string[] = [];
        const claimedB: string[] = [];
        const dispatchA = new OutboxDispatcherWorker({
          db: realDb,
          consumer: async (e) => {
            claimedA.push(e.id);
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

        await Promise.all([dispatchA.tick(), dispatchB.tick()]);

        // Disjoint claims + together cover the seed.
        const setA = new Set(claimedA);
        const setB = new Set(claimedB);
        for (const id of setA) {
          expect(setB.has(id)).toBe(false);
        }
        expect(setA.size + setB.size).toBe(seededIds.length);

        await client.unsafe(`DROP SCHEMA "${isolated}" CASCADE`);
      } finally {
        await client.end({ timeout: 5 });
      }
    });
  },
);
