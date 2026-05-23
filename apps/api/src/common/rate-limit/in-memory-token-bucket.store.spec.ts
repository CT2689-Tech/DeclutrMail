import { describe, expect, it } from 'vitest';

import { InMemoryTokenBucketStore } from './in-memory-token-bucket.store.js';
import { type ResolvedRateLimit } from './rate-limit.types.js';

/**
 * Bucket math tests (D156).
 *
 * The InMemoryTokenBucketStore mirrors the Lua script line-for-line —
 * verifying it here verifies the production algorithm. If these tests
 * pass but production behaves differently, the Lua script has drifted.
 */
const CONFIG: ResolvedRateLimit = { bucket: 'auth', limit: 5, windowSec: 60 };

describe('InMemoryTokenBucketStore', () => {
  it('starts full: first `limit` consumes all succeed at t=0', async () => {
    const store = new InMemoryTokenBucketStore();
    for (let i = 0; i < CONFIG.limit; i++) {
      const r = await store.consume('k', CONFIG, 0);
      expect(r.allowed).toBe(true);
    }
  });

  it('rejects the next consume after capacity is drained', async () => {
    const store = new InMemoryTokenBucketStore();
    for (let i = 0; i < CONFIG.limit; i++) {
      await store.consume('k', CONFIG, 0);
    }
    const r = await store.consume('k', CONFIG, 0);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      // refill = limit / windowSec = 5/60 token/sec; deficit ~1; ceil(1 / (5/60)) = 12
      expect(r.retryAfterSec).toBe(12);
    }
  });

  it('refills proportionally to elapsed time, capped at capacity', async () => {
    const store = new InMemoryTokenBucketStore();
    // Drain.
    for (let i = 0; i < CONFIG.limit; i++) {
      await store.consume('k', CONFIG, 0);
    }
    // Wait 12s: refill = 12 * (5/60) = 1 token. One consume should succeed.
    const r1 = await store.consume('k', CONFIG, 12_000);
    expect(r1.allowed).toBe(true);

    // Immediately try again — should be denied (bucket back to ~0).
    const r2 = await store.consume('k', CONFIG, 12_000);
    expect(r2.allowed).toBe(false);
  });

  it('caps refill at capacity (long idle does not grant extra tokens)', async () => {
    const store = new InMemoryTokenBucketStore();
    await store.consume('k', CONFIG, 0); // 4 tokens left.
    // Wait an hour — way more than enough to refill, but cap at 5.
    for (let i = 0; i < CONFIG.limit; i++) {
      const r = await store.consume('k', CONFIG, 3_600_000);
      expect(r.allowed).toBe(true);
    }
    const r = await store.consume('k', CONFIG, 3_600_000);
    expect(r.allowed).toBe(false);
  });

  it('isolates buckets by key (one user does not affect another)', async () => {
    const store = new InMemoryTokenBucketStore();
    for (let i = 0; i < CONFIG.limit; i++) {
      await store.consume('user:a', CONFIG, 0);
    }
    // user:a is drained; user:b is still full.
    const a = await store.consume('user:a', CONFIG, 0);
    const b = await store.consume('user:b', CONFIG, 0);
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(true);
  });

  it('retryAfterSec is always at least 1 second', async () => {
    // Tiny window where the natural ceil could round to 0; guarantee min 1.
    const tight: ResolvedRateLimit = { bucket: 'default', limit: 1000, windowSec: 1 };
    const store = new InMemoryTokenBucketStore();
    for (let i = 0; i < tight.limit; i++) {
      await store.consume('k', tight, 0);
    }
    const r = await store.consume('k', tight, 0);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });

  it('clamps negative time travel to zero refill', async () => {
    const store = new InMemoryTokenBucketStore();
    for (let i = 0; i < CONFIG.limit; i++) {
      await store.consume('k', CONFIG, 10_000);
    }
    // Clock goes backwards (NTP skew). Should not grant refill, but
    // should not crash either.
    const r = await store.consume('k', CONFIG, 5_000);
    expect(r.allowed).toBe(false);
  });
});
