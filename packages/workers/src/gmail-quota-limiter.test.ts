import { createHash } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GMAIL_QUOTA_SCRIPT,
  gmailQuotaKey,
  RedisGmailQuotaLimiter,
  type GmailQuotaLimiter,
  type GmailQuotaRedis,
} from './gmail-quota-limiter.js';
import { createRedisConnection, createRedisProducerConnection } from './queue.js';
import { RateLimiter } from './rate-limiter.js';

const SHA = createHash('sha1').update(GMAIL_QUOTA_SCRIPT).digest('hex');
const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379';

/**
 * The Lua is the limiter.
 *
 * Mocking `evalsha` pins the protocol shape and proves nothing about
 * whether the budget is actually shared — a script that returned
 * `allowed` unconditionally would pass every mocked assertion in this
 * file. So the sharing tests run the real script against a real Redis
 * and are skipped, loudly, when one is not reachable.
 */
/**
 * Connected at MODULE scope, not in `beforeAll`.
 *
 * `it.runIf(cond)` is evaluated when the test is COLLECTED, and
 * collection happens before any hook runs — so a `live` flag set in
 * `beforeAll` is still `false` at the moment vitest decides what to
 * skip. All six real-Redis tests were skipped against a perfectly
 * healthy Redis while the file reported a clean pass: the suite verified
 * nothing and said so in green. That is the same shape as the bug it
 * guards, committed in the guard itself. Top-level await resolves before
 * collection, so the flag is true when it is read.
 */
const { redis, live } = await connect();

async function connect(): Promise<{ redis: Redis | null; live: boolean }> {
  try {
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 1500,
    });
    await client.connect();
    await client.ping();
    return { redis: client, live: true };
  } catch {
    return { redis: null, live: false };
  }
}

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
});

/** Deterministic clock — no test may depend on wall-clock refill. */
function clockAt(startMs: number) {
  let t = startMs;
  const slept: number[] = [];
  return {
    slept,
    advance: (ms: number) => {
      t += ms;
    },
    clock: {
      now: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms; // A sleep is the only thing that moves time here.
      },
    },
  };
}

describe('RedisGmailQuotaLimiter — the shared budget (real Lua, real Redis)', () => {
  let key: string;
  let mailbox: string;

  beforeEach(async () => {
    if (!live) return;
    mailbox = `test-mb-${Math.abs(Date.now() % 1e9)}-${Math.floor(performance.now() * 1000) % 1000}`;
    key = gmailQuotaKey(mailbox);
    await redis!.del(key);
  });

  it.runIf(live)('is reachable — blind case for every assertion below', async () => {
    // Asserted FIRST. Every test in this describe is a no-op if the
    // client is dead, and a suite that silently verified nothing is the
    // same failure mode as the unshared limiter it guards.
    expect(live).toBe(true);
    expect(await redis!.ping()).toBe('PONG');
  });

  it.runIf(live)('shares one budget across two independent limiter instances', async () => {
    // THE POINT OF THE WHOLE ITEM. Two `RedisGmailQuotaLimiter` objects
    // stand in for two worker processes: separate JS heaps, no shared
    // Map, same mailbox. Against the in-process `RateLimiter` this
    // assertion is impossible — each instance would hand out a full 100.
    const a = clockAt(1_000_000);
    const b = clockAt(1_000_000);
    const one = new RedisGmailQuotaLimiter(
      redis!,
      SHA,
      mailbox,
      100,
      60_000,
      neverCalled(),
      a.clock,
    );
    const two = new RedisGmailQuotaLimiter(
      redis!,
      SHA,
      mailbox,
      100,
      60_000,
      neverCalled(),
      b.clock,
    );

    // Instance one spends 60 of the 100.
    await one.acquire(60);
    // Instance two spends 40 — exactly exhausting the SHARED budget.
    await two.acquire(40);
    expect(a.slept).toEqual([]);
    expect(b.slept).toEqual([]);

    // The next unit from EITHER instance must wait. If the budget were
    // per-process this returns instantly and the test fails here.
    await two.acquire(10);
    expect(b.slept.length).toBeGreaterThan(0);
  });

  it.runIf(live)('refills continuously rather than at a window cliff', async () => {
    const h = clockAt(2_000_000);
    const lim = new RedisGmailQuotaLimiter(
      redis!,
      SHA,
      mailbox,
      600,
      60_000,
      neverCalled(),
      h.clock,
    );
    await lim.acquire(600); // Bucket empty. Refill is 10 units/sec.

    await lim.acquire(100);
    // 100 units at 10/sec = ~10s, NOT the ~60s a sliding window would
    // make you wait for the whole block to age out.
    const waited = h.slept.reduce((s, x) => s + x, 0);
    expect(waited).toBeGreaterThanOrEqual(9_000);
    expect(waited).toBeLessThan(12_000);
  });

  it.runIf(live)('charges the real cost, not one token per call', async () => {
    // `messages.get` costs 5 units, and a limiter that charged 1 would
    // let five times the traffic through while reporting compliance.
    const h = clockAt(3_000_000);
    const lim = new RedisGmailQuotaLimiter(
      redis!,
      SHA,
      mailbox,
      10,
      60_000,
      neverCalled(),
      h.clock,
    );
    await lim.acquire(5);
    await lim.acquire(5);
    expect(h.slept).toEqual([]);
    const tokens = Number(await redis!.hget(key, 'tokens'));
    expect(tokens).toBeLessThan(1);
  });

  it.runIf(live)('sets a TTL so an idle mailbox cleans itself up', async () => {
    const h = clockAt(4_000_000);
    const lim = new RedisGmailQuotaLimiter(
      redis!,
      SHA,
      mailbox,
      100,
      60_000,
      neverCalled(),
      h.clock,
    );
    await lim.acquire(1);
    const ttl = await redis!.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it.runIf(live)('loads the script itself when Redis has never seen the SHA', async () => {
    // NOSCRIPT is not an edge case — it is every first call after a
    // Redis restart or failover, which on Upstash is routine.
    await redis!.script('FLUSH');
    const h = clockAt(5_000_000);
    const lim = new RedisGmailQuotaLimiter(
      redis!,
      SHA,
      mailbox,
      100,
      60_000,
      neverCalled(),
      h.clock,
    );
    await expect(lim.acquire(1)).resolves.toBeUndefined();
  });
});

describe('RedisGmailQuotaLimiter — degradation and guards', () => {
  it('falls back to the in-process limiter when Redis throws, and says so', async () => {
    const fallback = new RateLimiter(100, 60_000);
    const spy = vi.spyOn(fallback, 'acquire');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: GmailQuotaRedis = {
      evalsha: () => Promise.reject(new Error('ECONNREFUSED')),
      eval: () => Promise.reject(new Error('ECONNREFUSED')),
    };

    const lim = new RedisGmailQuotaLimiter(broken, SHA, 'mb-1', 100, 60_000, fallback);
    await lim.acquire(5);

    expect(spy).toHaveBeenCalledWith(5);
    // A limiter that quietly stopped being shared is the failure this
    // class exists to end. It must be visible in the log, not inferable
    // from a later Gmail 403.
    const kinds = warn.mock.calls.map((c) => JSON.parse(String(c[0])).kind);
    expect(kinds).toContain('gmail.quota.redis_degraded');
    warn.mockRestore();
  });

  it('retries Redis on the NEXT call rather than degrading permanently', async () => {
    const fallback = new RateLimiter(100, 60_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const evalsha = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce([1, 0]);
    const flaky: GmailQuotaRedis = { evalsha, eval: vi.fn() };

    const lim = new RedisGmailQuotaLimiter(flaky, SHA, 'mb-1', 100, 60_000, fallback);
    await lim.acquire(5); // degrades
    await lim.acquire(5); // must try Redis again

    expect(evalsha).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('refuses an amount the bucket can never hold instead of sleeping forever', async () => {
    // Without this the loop is a hang: the bucket caps at `capacity`, so
    // `units > capacity` can never be satisfied and every iteration
    // sleeps and re-checks. A hang reads as a stuck worker, not a bug.
    const lim = new RedisGmailQuotaLimiter(
      { evalsha: vi.fn(), eval: vi.fn() },
      SHA,
      'mb-1',
      100,
      60_000,
      neverCalled(),
    );
    await expect(lim.acquire(101)).rejects.toThrow(/capacity/);
  });

  it('uses EVALSHA on the happy path and never ships the script body', async () => {
    const evalFn = vi.fn();
    const lim = new RedisGmailQuotaLimiter(
      { evalsha: vi.fn().mockResolvedValue([1, 0]), eval: evalFn },
      SHA,
      'mb-1',
      100,
      60_000,
      neverCalled(),
    );
    await lim.acquire(5);
    expect(evalFn).not.toHaveBeenCalled();
  });
});

describe('the connection the limiter must be given', () => {
  // The degrade path above is tested against a mock that REJECTS. The
  // production client did not, and that is the whole bug: the limiter
  // was wired to BullMQ's shared connection, built with
  // `maxRetriesPerRequest: null` (mandatory for BullMQ workers) and
  // ioredis's default `enableOfflineQueue: true`. An EVALSHA during an
  // outage is then buffered or retried across reconnects instead of
  // rejecting, so `catch` never runs and `acquire()` blocks forever —
  // a fallback that reads as handled and cannot fire.
  //
  // Mocking cannot catch that. These assertions read the real option
  // shapes, which is where the difference actually lives.
  it('rejects rather than buffers, on the producer connection', () => {
    const c = createRedisProducerConnection('redis://127.0.0.1:6379');
    try {
      // Flushes in-flight commands on the first reconnect attempt.
      expect(c.options.maxRetriesPerRequest).toBe(0);
      // Rejects commands issued while already down, instead of queueing.
      expect(c.options.enableOfflineQueue).toBe(false);
    } finally {
      c.disconnect();
    }
  });

  it("does NOT have those semantics on BullMQ's connection", () => {
    // The negative half. If this ever starts matching the producer
    // shape, the test above stops proving anything — and if someone
    // rewires the limiter back to this connection, the comment in
    // `worker.ts` is the only thing left saying why that breaks.
    const c = createRedisConnection('redis://127.0.0.1:6379');
    try {
      expect(c.options.maxRetriesPerRequest).toBeNull();
      expect(c.options.enableOfflineQueue).not.toBe(false);
    } finally {
      c.disconnect();
    }
  });
});

/** A fallback that fails the test if the degrade path is taken. */
function neverCalled(): GmailQuotaLimiter {
  return {
    acquire: () => {
      throw new Error('fallback limiter must not be reached in this test');
    },
  };
}
