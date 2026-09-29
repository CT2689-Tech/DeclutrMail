import { describe, expect, it } from 'vitest';
import { quietHoursQueryOptions } from './query-options';

/**
 * "N Autopilot actions are held." and the "Quiet now" pill are a
 * point-in-time read with no other trigger to refresh them — no
 * `refetchOnWindowFocus` (query-client.ts), and only the save PUT
 * invalidates this key. Without a poll, an open tab keeps showing a
 * quiet window as active, and its held count as current, long after
 * the window actually ended (design-system review, PR #808).
 */
describe('quietHoursQueryOptions — self-refreshing', () => {
  const reader = async () => {
    throw new Error('not called');
  };

  it('polls, so an open tab does not hold a stale "Quiet now" indefinitely', () => {
    expect(quietHoursQueryOptions('mb-1', reader).refetchInterval).toBeTypeOf('number');
    expect(quietHoursQueryOptions('mb-1', reader).refetchInterval as number).toBeGreaterThan(0);
  });
});
