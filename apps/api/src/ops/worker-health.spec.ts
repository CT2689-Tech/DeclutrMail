import { describe, expect, it, vi } from 'vitest';
import { WorkerHealth, workerHealthResponse } from './worker-health.js';

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('worker progress health', () => {
  it('fails before the first successful write and when an in-flight heartbeat stalls, while collection continues', async () => {
    let now = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heartbeat = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(held);
    const collect = vi.fn().mockResolvedValue(undefined);
    const health = new WorkerHealth(heartbeat, collect, vi.fn(), () => now);
    expect(health.isFresh()).toBe(false);
    health.tick();
    await flush();
    expect(health.isFresh()).toBe(true);
    now = 60_000;
    health.tick();
    await flush();
    now = 300_000;
    expect(health.isFresh()).toBe(false);
    health.tick();
    await flush();
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(collect).toHaveBeenCalledTimes(2);
    release();
    await health.drain();
    expect(health.isFresh()).toBe(true);
  });

  it('never overlaps collection and never treats a failed heartbeat as progress', async () => {
    let now = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const collect = vi.fn().mockReturnValue(held);
    const failed = vi.fn();
    const heartbeat = vi.fn().mockRejectedValue(new Error('private provider content'));
    const health = new WorkerHealth(heartbeat, collect, failed, () => now);
    health.tick();
    await flush();
    now = 600_000;
    health.tick();
    await flush();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(health.isFresh()).toBe(false);
    expect(failed).toHaveBeenCalledWith('worker.heartbeat_failed');
    expect(JSON.stringify(failed.mock.calls)).not.toContain('private provider content');
    release();
    await health.drain();
  });
});

it('reports startup, fresh, stalled and intentionally held probe states truthfully', () => {
  expect(workerHealthResponse(false, false, false)).toEqual({ statusCode: 503, body: 'starting' });
  expect(workerHealthResponse(true, false, true)).toEqual({ statusCode: 200, body: 'ok' });
  expect(workerHealthResponse(true, false, false)).toEqual({ statusCode: 503, body: 'degraded' });
  expect(workerHealthResponse(false, true, false)).toEqual({
    statusCode: 200,
    body: 'admission-held',
  });
});
