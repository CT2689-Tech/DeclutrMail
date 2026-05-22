import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rate-limiter.js';

/**
 * RateLimiter tests (D5). `reserve()` is the pure window check — tested
 * with an explicit clock; `acquire()` is tested with a fake clock that
 * the fake `sleep` advances, so pacing is deterministic.
 */
describe('RateLimiter.reserve', () => {
  it('allows spends up to maxUnits within the window', () => {
    const rl = new RateLimiter(15, 1000);
    expect(rl.reserve(5, 0)).toBe(0);
    expect(rl.reserve(5, 10)).toBe(0);
    expect(rl.reserve(5, 20)).toBe(0); // 15 units used — at the cap
  });

  it('returns a wait when the next spend would breach the cap', () => {
    const rl = new RateLimiter(15, 1000);
    rl.reserve(5, 0);
    rl.reserve(5, 0);
    rl.reserve(5, 0); // 15 used at t=0
    // A 4th spend at t=500 must wait for the oldest (t=0) to age out.
    expect(rl.reserve(5, 500)).toBe(1000 - 500 + 1);
  });

  it('frees budget as events leave the window', () => {
    const rl = new RateLimiter(10, 1000);
    rl.reserve(5, 0);
    rl.reserve(5, 0); // full at t=0
    expect(rl.reserve(5, 500)).toBeGreaterThan(0); // still within window
    // At t=1000 the t=0 events have aged out — budget is free again.
    expect(rl.reserve(5, 1000)).toBe(0);
  });
});

describe('RateLimiter.acquire', () => {
  it('paces a burst — total time spans the windows the spends require', async () => {
    // maxUnits=10 / window=1000 → 2 spends of 5 per window.
    let clock = 0;
    const rl = new RateLimiter(10, 1000, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    // 6 spends of 5 = 30 units → 3 windows → clock advances ~2 windows.
    for (let i = 0; i < 6; i += 1) {
      await rl.acquire(5);
    }
    expect(clock).toBeGreaterThanOrEqual(2000);
  });

  it('does not delay when spends stay under the cap', async () => {
    let clock = 0;
    let sleeps = 0;
    const rl = new RateLimiter(1000, 1000, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        sleeps += 1;
      },
    });
    for (let i = 0; i < 10; i += 1) {
      await rl.acquire(5);
    }
    expect(sleeps).toBe(0);
  });
});
