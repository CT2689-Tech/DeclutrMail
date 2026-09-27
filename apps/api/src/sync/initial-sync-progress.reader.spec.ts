import { createServer, type AddressInfo, type Socket } from 'node:net';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { scanProgressKey } from '@declutrmail/workers';

import {
  createScanProgressRedis,
  InitialSyncProgressReader,
} from './initial-sync-progress.reader.js';

/**
 * The gate's "12,400 of 40,898 emails" line reads the counts the
 * InitialSyncWorker writes to its short-lived Redis key. No counts is
 * `null`; a read that cannot vouch for the numbers is `undefined` — the
 * line disappears either way. Never a default 0, never another run's count.
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
    const handlers: Array<(err: Error) => void> = [];
    const redis = {
      get: vi.fn(get),
      on: vi.fn((_event: string, handler: (err: Error) => void) => {
        handlers.push(handler);
        return redis;
      }),
    };
    const r = new InitialSyncProgressReader(redis as unknown as Pick<Redis, 'get' | 'on'>);
    return { redis, reader: r, emitError: (err: Error) => handlers.forEach((h) => h(err)) };
  }
  const warnLines = () =>
    warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
  const warnKinds = () => warnLines().map((l) => l['kind']);

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
    ['not JSON', 'processed=500', 'not_json'],
    ['more read than listed', stored({ processed: 11, total: 10, at: 1 }), ':custom'],
    ['half the pair', stored({ processed: 10, at: 1 }), 'total:invalid_type'],
    [
      'an extra key',
      stored({ processed: 1, total: 10, at: 1, subject: 'Hello' }),
      ':unrecognized_keys[subject]',
    ],
  ])('is unknown, and says which rule failed, for %s', async (_label, raw, reason) => {
    const { reader: r } = reader(async () => raw);

    await expect(r.read('mb-1', READING)).resolves.toBeUndefined();
    expect(warnLines()).toEqual([
      {
        level: 'warn',
        kind: 'sync.scan_progress_unreadable',
        mailboxAccountId: 'mb-1',
        message: reason,
      },
    ]);
    // Never the stored value — only which field broke which rule.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Hello');
  });

  it('is unknown, and says so, when Redis cannot be read', async () => {
    const { reader: r } = reader(async () => {
      throw new Error('Command timed out');
    });

    await expect(r.read('mb-1', READING)).resolves.toBeUndefined();
    expect(warnKinds()).toEqual(['sync.scan_progress_read_failed']);
  });

  // Silent-failure round 2 (2026-09-26): the client's deadline also bounds
  // its own handshake, so a slow Redis never lets it become ready — and
  // every read then fails with a bare "Stream isn't writeable".
  it("logs the client's own connection errors, which no read would name", () => {
    const { emitError } = reader(async () => null);

    emitError(new Error('Command timed out'));

    expect(warnLines()).toEqual([
      { level: 'warn', kind: 'sync.scan_progress_connection_error', message: 'Command timed out' },
    ]);
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
    // …and the next line says how many it held back.
    expect(warnLines()[1]).toMatchObject({ suppressed: 1 });
  });
});

describe('createScanProgressRedis', () => {
  const READING: Pick<SyncStatus, 'readiness_status' | 'current_stage'> = {
    readiness_status: 'syncing',
    current_stage: 'fetching_metadata',
  };

  // Flow round 2 (2026-09-26): nothing pinned the deadline. Without it a
  // Redis that stops answering after connecting holds every status poll.
  it('gives up on a Redis that stops answering within the half-second deadline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Answers until the client is ready (its INFO check), then never again.
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      let answering = true;
      socket.on('data', (chunk) => {
        for (const [, command] of chunk.toString().matchAll(/\*\d+\r\n\$\d+\r\n(\w+)\r\n/g)) {
          if (!answering) return;
          if (command!.toUpperCase() === 'INFO') {
            const info = '# Server\r\nredis_version:7.2.0\r\nloading:0\r\n';
            socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
            answering = false;
          } else {
            socket.write('+OK\r\n');
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const client = createScanProgressRedis(`redis://127.0.0.1:${port}`);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('ready', resolve);
        client.once('error', reject);
      });
      const r = new InitialSyncProgressReader(client);

      const started = Date.now();
      await expect(r.read('mb-1', READING)).resolves.toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(String(warn.mock.calls.at(-1)?.[0])).toContain('sync.scan_progress_read_failed');
    } finally {
      client.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      warn.mockRestore();
    }
  });
});
