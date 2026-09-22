import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './rate-limiter.js';
import { RedisGmailQuotaLimiter } from './gmail-quota-limiter.js';
afterEach(() => vi.useRealTimers());
describe('quota cancellation', () => {
  it('cancels a local quota wait and removes its timer without granting new units', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(5, 60000);
    await limiter.acquire(5);
    const controller = new AbortController();
    const attempt = limiter.acquire(5, controller.signal).catch((error: Error) => error);
    controller.abort(new Error('stop'));
    expect(await attempt).toHaveProperty('message', 'stop');
    expect(vi.getTimerCount()).toBe(0);
    expect(limiter.reserve(5, Date.now())).toBeGreaterThan(0);
  });
  it('cancels Redis pacing without a new reservation or local fallback', async () => {
    vi.useFakeTimers();
    const redis = { evalsha: vi.fn(async () => [0, 60000]), eval: vi.fn() };
    const fallback = { acquire: vi.fn() };
    const limiter = new RedisGmailQuotaLimiter(
      redis,
      'sha',
      'fixture',
      100,
      12000,
      60000,
      fallback,
    );
    const controller = new AbortController();
    const attempt = limiter.acquire(5, controller.signal).catch((error: Error) => error);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error('stop'));
    expect(await attempt).toHaveProperty('message', 'stop');
    expect(redis.evalsha).toHaveBeenCalledTimes(1);
    expect(fallback.acquire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
