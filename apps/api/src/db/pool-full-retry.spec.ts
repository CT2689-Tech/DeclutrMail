import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { isPoolFull, POOL_FULL_RETRY_DELAYS_MS, retryWhilePoolFull } from './pool-full-retry.js';

/** The exact message Supavisor returned in production on 2026-11-19. */
const POOL_FULL = new Error(
  '(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15',
);

const noSleep = () => Promise.resolve();

describe('isPoolFull', () => {
  it('recognizes the Supavisor full-pool refusal and nothing else', () => {
    expect(isPoolFull(POOL_FULL)).toBe(true);
    expect(isPoolFull(new Error('read ECONNRESET'))).toBe(false);
    expect(isPoolFull(new Error('password authentication failed'))).toBe(false);
    expect(isPoolFull('max clients reached')).toBe(true);
  });
});

describe('retryWhilePoolFull', () => {
  it('waits while the pool is full, then returns once a slot frees', async () => {
    const connect = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(POOL_FULL)
      .mockRejectedValueOnce(POOL_FULL)
      .mockResolvedValue('listening');
    const onRetry = vi.fn();
    const sleep = vi.fn(noSleep);
    await expect(
      retryWhilePoolFull(connect, { delaysMs: [10, 20, 30], onRetry, sleep }),
    ).resolves.toBe('listening');
    expect(connect).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls).toEqual([
      [1, 10],
      [2, 20],
    ]);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('throws any other error at once: a real outage still fails boot', async () => {
    const outage = new Error('getaddrinfo ENOTFOUND pooler');
    const connect = vi.fn<() => Promise<void>>().mockRejectedValue(outage);
    const onRetry = vi.fn();
    await expect(
      retryWhilePoolFull(connect, { delaysMs: [10, 20], onRetry, sleep: noSleep }),
    ).rejects.toBe(outage);
    expect(connect).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('gives up after the last wait with the pooler’s own error', async () => {
    const connect = vi.fn<() => Promise<void>>().mockRejectedValue(POOL_FULL);
    await expect(
      retryWhilePoolFull(connect, { delaysMs: [10, 20], onRetry: () => {}, sleep: noSleep }),
    ).rejects.toBe(POOL_FULL);
    expect(connect).toHaveBeenCalledTimes(3);
  });
});

describe('POOL_FULL_RETRY_DELAYS_MS', () => {
  it('finishes inside the worker startup probe window, so the deploy still fails loudly', () => {
    const workflow = readFileSync(
      resolve(__dirname, '../../../../.github/workflows/deploy-cloud-run.yml'),
      'utf8',
    );
    const probe = /--startup-probe="[^"]*periodSeconds=(\d+)[^"]*failureThreshold=(\d+)"/.exec(
      workflow,
    );
    expect(probe, 'worker startup probe not found in deploy-cloud-run.yml').not.toBeNull();
    const windowMs = Number(probe![1]) * Number(probe![2]) * 1000;
    const totalMs = POOL_FULL_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(totalMs).toBeGreaterThan(0);
    // Leave room for the rest of boot after the last try.
    expect(totalMs).toBeLessThan(windowMs * 0.6);
  });
});
