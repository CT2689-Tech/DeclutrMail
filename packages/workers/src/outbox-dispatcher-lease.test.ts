import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { outboxEvents, schema } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';

import {
  RedisOutboxDispatcherLease,
  type OutboxDispatcherLease,
} from './outbox-dispatcher-lease.js';
import { OutboxDispatcherWorker } from './outbox-dispatcher.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { createRedisConnection } from './queue.js';

// CI provides TEST_REDIS_URL; local runs may own an ephemeral Redis server.
// Never use application REDIS_URL. Every test owns a unique lease key.
let redis: Redis;
let server: ReturnType<typeof spawn> | undefined;

beforeAll(async () => {
  let redisUrl = process.env.TEST_REDIS_URL;
  if (redisUrl) {
    const target = new URL(redisUrl);
    if (target.protocol !== 'redis:' || !['127.0.0.1', 'localhost'].includes(target.hostname))
      throw new Error('Outbox lease tests require a local test Redis');
  } else {
    if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0)
      throw new Error('Outbox lease tests need TEST_REDIS_URL or the Redis test executable');
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port');
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    server = spawn(
      'redis-server',
      ['--bind', '127.0.0.1', '--port', String(address.port), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
    await once(server, 'spawn');
    redisUrl = `redis://127.0.0.1:${address.port}`;
  }
  redis = createRedisConnection(redisUrl);
  await redis.ping();
});

afterAll(async () => {
  await redis?.quit();
  server?.kill();
});

const silent = () => {};
const key = () => `outbox-lease-test:${randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RedisOutboxDispatcherLease', () => {
  it('admits exactly one holder per key', async () => {
    const shared = key();
    const a = new RedisOutboxDispatcherLease(redis, { key: shared, log: silent });
    const b = new RedisOutboxDispatcherLease(redis, { key: shared, log: silent });
    expect(await a.ensureHeld()).toBe(true);
    expect(await b.ensureHeld()).toBe(false);
    expect(a.isHeld()).toBe(true);
    expect(b.isHeld()).toBe(false);
    await a.release();
    await b.release();
  });

  it('hands over on release, and a non-owner release never frees the holder', async () => {
    const shared = key();
    const a = new RedisOutboxDispatcherLease(redis, { key: shared, log: silent });
    const b = new RedisOutboxDispatcherLease(redis, { key: shared, log: silent });
    const stranger = new RedisOutboxDispatcherLease(redis, { key: shared, log: silent });
    expect(await a.ensureHeld()).toBe(true);
    await stranger.release();
    expect(await b.ensureHeld()).toBe(false);
    await a.release();
    expect(a.isHeld()).toBe(false);
    expect(await b.ensureHeld()).toBe(true);
    await b.release();
  });

  it('a crashed holder (never released) blocks takeover until its TTL lapses', async () => {
    const shared = key();
    const options = {
      key: shared,
      log: silent,
      ttlMs: 400,
      renewEveryMs: 100,
      safetyMarginMs: 100,
    };
    const crashed = new RedisOutboxDispatcherLease(redis, { ...options, commandTimeoutMs: 100 });
    const successor = new RedisOutboxDispatcherLease(redis, { ...options, commandTimeoutMs: 100 });
    expect(await crashed.ensureHeld()).toBe(true);
    expect(await successor.ensureHeld()).toBe(false);
    await sleep(450);
    expect(await successor.ensureHeld()).toBe(true);
    await successor.release();
  });

  it('local validity ends before the Redis key can expire', async () => {
    const shared = key();
    let clock = 1_000_000;
    const lease = new RedisOutboxDispatcherLease(redis, {
      key: shared,
      log: silent,
      now: () => clock,
    });
    expect(await lease.ensureHeld()).toBe(true);
    const pttl = await redis.pttl(shared);
    expect(pttl).toBeGreaterThan(25_000);
    clock += 24_999;
    expect(lease.isHeld()).toBe(true);
    clock += 1;
    expect(lease.isHeld()).toBe(false);
    await lease.release();
  });

  it('periodic renewal keeps a holder past its first TTL', async () => {
    const shared = key();
    const options = {
      key: shared,
      log: silent,
      ttlMs: 400,
      renewEveryMs: 100,
      safetyMarginMs: 100,
    };
    const holder = new RedisOutboxDispatcherLease(redis, { ...options, commandTimeoutMs: 100 });
    const rival = new RedisOutboxDispatcherLease(redis, { ...options, commandTimeoutMs: 100 });
    expect(await holder.ensureHeld()).toBe(true);
    holder.start(() => {});
    await sleep(900);
    expect(holder.isHeld()).toBe(true);
    expect(await rival.ensureHeld()).toBe(false);
    await holder.release();
  });

  it('a standby takes over through its renewal timer and signals onAcquired once', async () => {
    const shared = key();
    const options = {
      key: shared,
      log: silent,
      ttlMs: 400,
      renewEveryMs: 100,
      safetyMarginMs: 100,
    };
    const holder = new RedisOutboxDispatcherLease(redis, { ...options, commandTimeoutMs: 100 });
    const standby = new RedisOutboxDispatcherLease(redis, { ...options, commandTimeoutMs: 100 });
    expect(await holder.ensureHeld()).toBe(true);
    let acquired = 0;
    standby.start(() => {
      acquired += 1;
    });
    await sleep(250);
    expect(acquired).toBe(0);
    await holder.release();
    await sleep(250);
    expect(acquired).toBe(1);
    expect(standby.isHeld()).toBe(true);
    await standby.release();
  });

  it('stands down and logs when Redis does not answer', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const hung = { eval: () => new Promise<never>(() => {}) } as unknown as Pick<Redis, 'eval'>;
    const lease = new RedisOutboxDispatcherLease(hung, {
      key: key(),
      commandTimeoutMs: 20,
      log: (line) => lines.push(line),
    });
    expect(await lease.ensureHeld()).toBe(false);
    expect(lease.isHeld()).toBe(false);
    expect(lines).toEqual([
      expect.objectContaining({ level: 'warn', kind: 'outbox.dispatch.lease_unavailable' }),
    ]);
  });

  it('a renewal failure drops a held lease immediately', async () => {
    let fail = false;
    const flaky = {
      eval: (...args: Parameters<Redis['eval']>) =>
        fail ? Promise.reject(new Error('down')) : redis.eval(...args),
    } as unknown as Pick<Redis, 'eval'>;
    const lease = new RedisOutboxDispatcherLease(flaky, {
      key: key(),
      log: silent,
      ttlMs: 400,
      renewEveryMs: 50,
      safetyMarginMs: 100,
      commandTimeoutMs: 100,
    });
    expect(await lease.ensureHeld()).toBe(true);
    lease.start(() => {});
    fail = true;
    await sleep(120);
    expect(lease.isHeld()).toBe(false);
    await lease.release();
  });

  it('a renewal still in flight at release never re-arms the lease', async () => {
    const shared = key();
    let gate: (() => void) | undefined;
    const slow = {
      eval: async (...args: Parameters<Redis['eval']>) => {
        if (gate === undefined) await new Promise<void>((resolve) => (gate = resolve));
        return redis.eval(...args);
      },
    } as unknown as Pick<Redis, 'eval'>;
    const lines: Record<string, unknown>[] = [];
    const lease = new RedisOutboxDispatcherLease(slow, {
      key: shared,
      log: (line) => lines.push(line),
    });
    const pending = lease.ensureHeld();
    await sleep(10);
    const released = lease.release();
    gate?.();
    expect(await pending).toBe(false);
    await released;
    expect(lease.isHeld()).toBe(false);
    expect(await lease.ensureHeld()).toBe(false);
    expect(await redis.get(shared)).toBeNull();
    expect(lines.map((line) => line.kind)).toEqual(['outbox.dispatch.lease_released']);
  });

  it('rejects a renewal cadence that cannot land inside the validity window', () => {
    expect(
      () =>
        new RedisOutboxDispatcherLease(redis, {
          ttlMs: 10_000,
          renewEveryMs: 4_000,
          safetyMarginMs: 2_000,
          commandTimeoutMs: 4_000,
        }),
    ).toThrow(/validity window/);
  });
});

/**
 * The cross-process scenario the lease exists for: an old worker abandons
 * a consumer call (an orphan) while a rollout starts a second worker on the
 * same database. Negative control: removing the orphan wait in
 * `OutboxDispatcherWorker.stop()` (releasing immediately) or dropping
 * `deps.lease` from either dispatcher lets `successor` invoke the unit
 * while the orphan is still running, and this test fails.
 */
describe('OutboxDispatcherWorker with a shared lease', () => {
  const EmptyPayload = z.object({}).strict();
  let pg: PGlite | null = null;
  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  it('a successor never runs a unit the previous holder orphaned until that call settles', async () => {
    pg = await freshTestPglite();
    const db = drizzle(pg, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
    let id = '';
    await db.transaction(async (tx) => {
      id = await new OutboxPublisher().publish(tx, {
        topic: 'triage.verdict_applied',
        aggregateId: 'rollout-1',
        payload: {},
        schema: EmptyPayload,
      });
    });
    let running = 0;
    let maxRunning = 0;
    let invocations = 0;
    let releaseOrphan!: () => void;
    const orphanGate = new Promise<void>((resolve) => {
      releaseOrphan = resolve;
    });
    const consumer = async () => {
      invocations += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      try {
        await orphanGate;
      } finally {
        running -= 1;
      }
    };
    const shared = key();
    const leaseOptions = { key: shared, log: silent };
    const old = new OutboxDispatcherWorker({
      db,
      consumer,
      consumerTimeoutMs: 30,
      pollIntervalMs: 60_000,
      lease: new RedisOutboxDispatcherLease(redis, leaseOptions),
    });
    const successorLease = new RedisOutboxDispatcherLease(redis, leaseOptions);
    const successor = new OutboxDispatcherWorker({
      db,
      consumer,
      consumerTimeoutMs: 30,
      pollIntervalMs: 60_000,
      lease: successorLease,
    });

    expect(await old.tick()).toMatchObject({ claimed: 1, consumerTimedOut: 1 });
    await old.stop();

    expect(await successor.tick()).toMatchObject({ claimed: 0 });
    expect(invocations).toBe(1);

    releaseOrphan();
    await sleep(20);
    expect(await successor.tick()).toMatchObject({ claimed: 1, dispatched: 1 });
    expect(invocations).toBe(2);
    expect(maxRunning).toBe(1);
    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    expect(row?.status).toBe('dispatched');
    await successor.stop();
    expect(await redis.exists(shared)).toBe(0);
  });

  it('renews through a boot drain that runs past the lease TTL', async () => {
    const db = await seed(1);
    const options = {
      key: key(),
      log: silent,
      ttlMs: 400,
      renewEveryMs: 50,
      safetyMarginMs: 100,
      commandTimeoutMs: 100,
    };
    let releaseConsumer!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseConsumer = resolve;
    });
    const worker = new OutboxDispatcherWorker({
      db,
      consumer: () => gate,
      consumerTimeoutMs: 5_000,
      pollIntervalMs: 60_000,
      lease: new RedisOutboxDispatcherLease(redis, options),
    });
    const started = worker.start();
    await sleep(700);
    const rival = new RedisOutboxDispatcherLease(redis, options);
    expect(await rival.ensureHeld()).toBe(false);
    releaseConsumer();
    await started;
    await worker.stop();
    expect(await rival.ensureHeld()).toBe(true);
    await rival.release();
  });

  /** In-memory lease: `held` is flipped by the test, `released` counts releases. */
  function fakeLease(initiallyHeld: boolean) {
    const state = { held: initiallyHeld, released: 0 };
    const lease: OutboxDispatcherLease = {
      ensureHeld: async () => state.held,
      isHeld: () => state.held,
      start: () => {},
      release: async () => {
        state.released += 1;
        state.held = false;
      },
    };
    return { state, lease };
  }

  async function seed(count: number) {
    pg = await freshTestPglite();
    const db = drizzle(pg, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
    for (let i = 0; i < count; i += 1) {
      await db.transaction(async (tx) => {
        await new OutboxPublisher().publish(tx, {
          topic: 'triage.verdict_applied',
          aggregateId: `unit-${i}`,
          payload: {},
          schema: EmptyPayload,
        });
      });
    }
    return db;
  }

  it('a standby claims nothing and leaves every row pending', async () => {
    const db = await seed(2);
    const { lease } = fakeLease(false);
    let invocations = 0;
    const worker = new OutboxDispatcherWorker({
      db,
      consumer: async () => {
        invocations += 1;
      },
      pollIntervalMs: 60_000,
      lease,
    });
    expect(await worker.tick()).toMatchObject({ claimed: 0, dispatched: 0 });
    expect(invocations).toBe(0);
    const rows = await db.select().from(outboxEvents);
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ]);
  });

  it('stops the batch at the first row after the lease lapses', async () => {
    const db = await seed(3);
    const { state, lease } = fakeLease(true);
    let invocations = 0;
    const worker = new OutboxDispatcherWorker({
      db,
      consumer: async () => {
        invocations += 1;
        state.held = false;
      },
      pollIntervalMs: 60_000,
      lease,
    });
    expect(await worker.tick()).toMatchObject({ claimed: 3, dispatched: 1 });
    expect(invocations).toBe(1);
    const rows = await db.select().from(outboxEvents);
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(2);
    expect(rows.every((row) => row.attempts === 0 || row.status === 'dispatched')).toBe(true);
  });

  // Negative control: starting renewal before `onReady` lets the takeover
  // tick below claim the row while runtime enrollment (#974) is still open.
  it('a takeover during runtime enrollment claims nothing until enrollment finishes', async () => {
    const db = await seed(1);
    const order: string[] = [];
    const { lease } = fakeLease(true);
    lease.start = (onAcquired) => {
      order.push('lease-start');
      onAcquired();
    };
    let finishEnrollment!: () => void;
    const enrollment = new Promise<void>((resolve) => {
      finishEnrollment = resolve;
    });
    const worker = new OutboxDispatcherWorker({
      db,
      consumer: async () => {
        order.push('consume');
      },
      pollIntervalMs: 60_000,
      lease,
    });
    const started = worker.start(async () => {
      order.push('enroll');
      await enrollment;
      order.push('enrolled');
    });
    await sleep(50);
    expect(order).toEqual(['enroll']);
    finishEnrollment();
    await started;
    await sleep(20);
    expect(order.slice(0, 3)).toEqual(['enroll', 'enrolled', 'lease-start']);
    expect(order.filter((step) => step === 'consume')).toHaveLength(1);
    await worker.stop();
  });

  it('stop() releases at once with no orphans, and only after an orphan settles otherwise', async () => {
    const db = await seed(1);
    const idle = fakeLease(true);
    const idleWorker = new OutboxDispatcherWorker({
      db,
      consumer: async () => {},
      pollIntervalMs: 60_000,
      lease: idle.lease,
    });
    await idleWorker.stop();
    expect(idle.state.released).toBe(1);

    const busy = fakeLease(true);
    let releaseOrphan!: () => void;
    const orphanGate = new Promise<void>((resolve) => {
      releaseOrphan = resolve;
    });
    const busyWorker = new OutboxDispatcherWorker({
      db,
      consumer: () => orphanGate,
      consumerTimeoutMs: 30,
      pollIntervalMs: 60_000,
      lease: busy.lease,
    });
    expect(await busyWorker.tick()).toMatchObject({ consumerTimedOut: 1 });
    await busyWorker.stop();
    expect(busy.state.released).toBe(0);
    expect(busy.state.held).toBe(true);
    releaseOrphan();
    await sleep(20);
    expect(busy.state.released).toBe(1);
  });
});
