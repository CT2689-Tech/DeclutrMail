import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedMap } from './bounded-map.js';
afterEach(() => vi.useRealTimers());
describe('bounded metadata pipeline', () => {
  it('refills slots across slow requests with bounded concurrency and ordered results', async () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: 40 }, (_, i) => i);
    let active = 0;
    let peak = 0;
    const fetch = async (id: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, id % 20 === 0 ? 100 : 10));
      active--;
      return id;
    };
    const start = Date.now();
    const streaming = boundedMap(ids, 20, fetch);
    await vi.runAllTimersAsync();
    expect(await streaming).toEqual(ids);
    const streamingMs = Date.now() - start;
    const waveStart = Date.now();
    const waves = (async () => {
      for (let i = 0; i < ids.length; i += 20) await Promise.all(ids.slice(i, i + 20).map(fetch));
    })();
    await vi.runAllTimersAsync();
    await waves;
    expect(peak).toBe(20);
    expect(streamingMs).toBe(110);
    expect(Date.now() - waveStart).toBe(200);
  });
  it('stops scheduling after failure and drains outstanding work before rejecting', async () => {
    let release!: () => void;
    const called: number[] = [];
    let settled = false;
    const result = boundedMap([0, 1, 2, 3], 2, async (id) => {
      called.push(id);
      if (id === 0) throw new Error('quota');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return id;
    }).catch((error: Error) => {
      settled = true;
      return error;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(called).toEqual([0, 1]);
    release();
    expect(await result).toHaveProperty('message', 'quota');
    expect(settled).toBe(true);
  });
});
