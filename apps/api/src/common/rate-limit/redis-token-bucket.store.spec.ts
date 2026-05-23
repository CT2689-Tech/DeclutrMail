import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { type ResolvedRateLimit } from './rate-limit.types.js';
import { RedisTokenBucketStore } from './redis-token-bucket.store.js';

/**
 * EVALSHA + NOSCRIPT-fallback (D156).
 *
 * The Redis store sends EVALSHA on every consume to avoid shipping the
 * Lua body. On a fresh connection (or after FLUSHALL / restart), Redis
 * has no cached script and replies `NOSCRIPT`. The store falls back to
 * EVAL, which both executes and primes the cache; the NEXT call goes
 * straight to EVALSHA again.
 *
 * We don't need a real Redis here — these tests pin the protocol shape
 * between the store and ioredis.
 */
const CONFIG: ResolvedRateLimit = { bucket: 'auth', limit: 5, windowSec: 60 };

type RedisMock = {
  evalsha: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
};

function mockRedis(): RedisMock {
  return {
    evalsha: vi.fn(),
    eval: vi.fn(),
  };
}

describe('RedisTokenBucketStore', () => {
  it('uses EVALSHA on the happy path (no EVAL)', async () => {
    const r = mockRedis();
    r.evalsha.mockResolvedValue([1, 4, 0]);
    const store = new RedisTokenBucketStore(r as unknown as Redis);

    const result = await store.consume('k', CONFIG, 1000);

    expect(result).toEqual({ allowed: true, remaining: 4 });
    expect(r.evalsha).toHaveBeenCalledTimes(1);
    expect(r.eval).not.toHaveBeenCalled();
  });

  it('falls back to EVAL on NOSCRIPT, then uses EVALSHA on the next call', async () => {
    const r = mockRedis();
    // First call: EVALSHA rejects with NOSCRIPT.
    r.evalsha.mockRejectedValueOnce(new Error('NOSCRIPT No matching script. Please use EVAL.'));
    r.eval.mockResolvedValueOnce([1, 4, 0]);
    // Second call: EVALSHA succeeds (script now cached server-side).
    r.evalsha.mockResolvedValueOnce([1, 3, 0]);

    const store = new RedisTokenBucketStore(r as unknown as Redis);

    const first = await store.consume('k', CONFIG, 1000);
    expect(first).toEqual({ allowed: true, remaining: 4 });
    expect(r.evalsha).toHaveBeenCalledTimes(1);
    expect(r.eval).toHaveBeenCalledTimes(1);

    const second = await store.consume('k', CONFIG, 1100);
    expect(second).toEqual({ allowed: true, remaining: 3 });
    // EVALSHA called once more (no second EVAL).
    expect(r.evalsha).toHaveBeenCalledTimes(2);
    expect(r.eval).toHaveBeenCalledTimes(1);
  });

  it('propagates non-NOSCRIPT EVALSHA errors (e.g. connection)', async () => {
    const r = mockRedis();
    r.evalsha.mockRejectedValue(new Error('ECONNREFUSED'));
    const store = new RedisTokenBucketStore(r as unknown as Redis);

    await expect(store.consume('k', CONFIG, 1000)).rejects.toThrow('ECONNREFUSED');
    expect(r.eval).not.toHaveBeenCalled();
  });

  it('translates allowed=0 into a deny with min retryAfterSec=1', async () => {
    const r = mockRedis();
    // Script could return retryAfterSec=0 on edge timing; the store
    // clamps to 1 so the client always sees a real backoff window.
    r.evalsha.mockResolvedValue([0, 0, 0]);
    const store = new RedisTokenBucketStore(r as unknown as Redis);

    const result = await store.consume('k', CONFIG, 1000);
    expect(result).toEqual({ allowed: false, retryAfterSec: 1 });
  });
});
