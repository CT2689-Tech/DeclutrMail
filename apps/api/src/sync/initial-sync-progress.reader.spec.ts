import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { scanProgressKey } from '@declutrmail/workers';

import { InitialSyncProgressReader } from './initial-sync-progress.reader.js';

/**
 * The gate's "12,400 of 40,898 emails" line reads the counts the
 * InitialSyncWorker writes to its short-lived Redis key. Every path that
 * cannot vouch for the numbers returns `null` — the line disappears.
 * Never a default 0, never another run's count.
 */
describe('InitialSyncProgressReader', () => {
  const READING: Pick<SyncStatus, 'readiness_status' | 'current_stage'> = {
    readiness_status: 'syncing',
    current_stage: 'fetching_metadata',
  };
  const stored = (record: object) => JSON.stringify(record);

  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  function reader(get: () => Promise<string | null>) {
    const redis = { get: vi.fn(get) };
    return { redis, reader: new InitialSyncProgressReader(redis) };
  }
  const warnKinds = () =>
    warn.mock.calls.map((c) => (JSON.parse(String(c[0])) as { kind: string }).kind);

  it("returns the running read's counts and how long ago they were written", async () => {
    const { reader: r, redis } = reader(async () =>
      stored({ processed: 12_400, total: 40_898, at: 97_500 }),
    );

    await expect(r.read('mb-1', READING)).resolves.toEqual({
      processed: 12_400,
      total: 40_898,
      age_ms: 2_500,
    });
    expect(redis.get).toHaveBeenCalledWith(scanProgressKey('mb-1'));
  });

  it('never reports a negative age when the worker clock runs ahead', async () => {
    const { reader: r } = reader(async () => stored({ processed: 1, total: 10, at: 100_400 }));

    await expect(r.read('mb-1', READING)).resolves.toMatchObject({ age_ms: 0 });
  });

  it.each([
    [
      'queued (a re-scan waiting to start)',
      { readiness_status: 'queued', current_stage: 'queued' },
    ],
    ['a later stage', { readiness_status: 'syncing', current_stage: 'building_sender_index' }],
    ['failed mid-read', { readiness_status: 'failed', current_stage: 'fetching_metadata' }],
    ['ready', { readiness_status: 'ready', current_stage: 'ready' }],
  ] as const)(
    'is null without touching Redis when the scan is not reading: %s',
    async (_label, status) => {
      const { reader: r, redis } = reader(async () =>
        stored({ processed: 40_898, total: 40_898, at: 99_000 }),
      );

      await expect(r.read('mb-1', status)).resolves.toBeNull();
      expect(redis.get).not.toHaveBeenCalled();
    },
  );

  it('is null, quietly, before the mailbox is listed or after a clear', async () => {
    const { reader: r } = reader(async () => null);

    await expect(r.read('mb-1', READING)).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'processed=500'],
    ['more read than listed', stored({ processed: 11, total: 10, at: 1 })],
    ['half the pair', stored({ processed: 10, at: 1 })],
    ['an extra key', stored({ processed: 1, total: 10, at: 1, subject: 'Hello' })],
  ])('is null, and says so, for %s', async (_label, raw) => {
    const { reader: r } = reader(async () => raw);

    await expect(r.read('mb-1', READING)).resolves.toBeNull();
    expect(warnKinds()).toEqual(['sync.scan_progress_unreadable']);
  });

  it('is null, and says so, when Redis cannot be read', async () => {
    const { reader: r } = reader(async () => {
      throw new Error('Command timed out');
    });

    await expect(r.read('mb-1', READING)).resolves.toBeNull();
    expect(warnKinds()).toEqual(['sync.scan_progress_read_failed']);
  });

  it('warns at most once a minute per kind — the route is polled every 3s', async () => {
    const { reader: r } = reader(async () => {
      throw new Error('Command timed out');
    });

    await r.read('mb-1', READING);
    vi.advanceTimersByTime(3_000);
    await r.read('mb-1', READING);
    expect(warnKinds()).toHaveLength(1);

    vi.advanceTimersByTime(60_000);
    await r.read('mb-1', READING);
    expect(warnKinds()).toHaveLength(2);
  });
});
