import { Redis } from 'ioredis';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createRedisScanProgressStore,
  parseScanProgressRecord,
  SCAN_PROGRESS_TTL_SECONDS,
  scanProgressKey,
  type ScanCounts,
} from './scan-progress.js';

const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379';

/**
 * The sync gate's counts cross a process boundary — the worker writes,
 * the API reads — so the round trip runs against a real Redis too, and
 * is skipped loudly when none is reachable. Connected at module scope:
 * `it.runIf` is decided at collection, before any hook runs.
 */
const { redis, live, reason } = await connect();

async function connect(): Promise<{ redis: Redis | null; live: boolean; reason: string }> {
  try {
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 1500,
    });
    await client.connect();
    await client.ping();
    return { redis: client, live: true, reason: 'reachable' };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`scan-progress.test: Redis at ${REDIS_URL} unreachable (${why})`);
    return { redis: null, live: false, reason: why };
  }
}

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
});

describe('scan progress store', () => {
  it('writes the counts with the time it wrote them, expiring after the TTL', async () => {
    const fake = { set: vi.fn(async () => 'OK' as const), del: vi.fn(async () => 1) };
    const store = createRedisScanProgressStore(fake, () => 1_000);

    await store.write('mb-1', { processed: 500, total: 1_200 });

    expect(fake.set).toHaveBeenCalledWith(
      'declutr:scan-progress:mb-1',
      JSON.stringify({ processed: 500, total: 1_200, at: 1_000 }),
      'EX',
      SCAN_PROGRESS_TTL_SECONDS,
    );
  });

  // Privacy round 2 (2026-09-26): pinned so a later spread of the input
  // cannot carry anything past the counts into Redis.
  it('stores only the counts and its write time, whatever else the caller passes', async () => {
    const fake = { set: vi.fn(async () => 'OK' as const), del: vi.fn(async () => 1) };
    const wider = { processed: 1, total: 2, subject: 'Hello' } as ScanCounts;

    await createRedisScanProgressStore(fake, () => 7).write('mb-1', wider);

    expect(fake.set).toHaveBeenCalledWith(
      'declutr:scan-progress:mb-1',
      '{"processed":1,"total":2,"at":7}',
      'EX',
      SCAN_PROGRESS_TTL_SECONDS,
    );
  });

  it.each([
    ['a zero total', { processed: 0, total: 0 }, /total:too_small/],
    ['more read than listed', { processed: 3, total: 2 }, /:custom/],
  ])('refuses %s — what the reader would reject — naming what failed', async (_l, counts, why) => {
    const fake = { set: vi.fn(async () => 'OK' as const), del: vi.fn(async () => 1) };

    await expect(createRedisScanProgressStore(fake).write('mb-1', counts)).rejects.toThrow(why);
    expect(fake.set).not.toHaveBeenCalled();
  });

  it('clears the counts on null', async () => {
    const fake = { set: vi.fn(async () => 'OK' as const), del: vi.fn(async () => 1) };

    await createRedisScanProgressStore(fake).write('mb-1', null);

    expect(fake.del).toHaveBeenCalledWith('declutr:scan-progress:mb-1');
    expect(fake.set).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'processed=500', 'not_json'],
    ['more read than listed', '{"processed":501,"total":500,"at":1}', ':custom'],
    ['no write time', '{"processed":1,"total":500}', 'at:invalid_type'],
    [
      'an extra key',
      '{"processed":1,"total":500,"at":1,"subject":"Hello"}',
      ':unrecognized_keys[subject]',
    ],
    ['a zero total', '{"processed":0,"total":0,"at":1}', 'total:too_small'],
  ])('reads %s as no record, saying which rule failed', (_label, raw, reason) => {
    expect(parseScanProgressRecord(raw)).toEqual({ ok: false, reason });
  });

  // ALWAYS runs: the round trip below is `runIf(live)`, so on its own it
  // can only pass or skip. CI sets TEST_REDIS_URL, so there an
  // unreachable Redis must fail, by name.
  it('reaches Redis whenever TEST_REDIS_URL is set', () => {
    if (process.env['TEST_REDIS_URL']) expect(reason).toBe('reachable');
  });

  it.runIf(live)('round-trips through a real Redis and clears', async () => {
    const mailbox = `test-mb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const key = scanProgressKey(mailbox);
    const store = createRedisScanProgressStore(redis!, () => 42);
    try {
      await store.write(mailbox, { processed: 12_400, total: 40_898 });
      expect(parseScanProgressRecord((await redis!.get(key))!)).toEqual({
        ok: true,
        record: { processed: 12_400, total: 40_898, at: 42 },
      });
      const ttl = await redis!.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(SCAN_PROGRESS_TTL_SECONDS);

      await store.write(mailbox, null);
      expect(await redis!.exists(key)).toBe(0);
    } finally {
      await redis!.del(key);
    }
  });
});
