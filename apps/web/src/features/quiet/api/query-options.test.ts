import { describe, expect, it } from 'vitest';
import { quietHoursQueryOptions } from './query-options';

/**
 * "N Autopilot actions are held." and the "Quiet now" pill are a
 * point-in-time read with no other trigger to refresh them — no
 * `refetchOnWindowFocus` (query-client.ts), and only the save PUT
 * invalidates this key. Without a poll, an open tab keeps showing a
 * quiet window as active, and its held count as current, long after
 * the window actually ended (design-system review, PR #808).
 *
 * The interval stays a number. Returning false while the tab is hidden
 * would clear TanStack's timer, and focus would not start it again.
 */
describe('quietHoursQueryOptions — self-refreshing', () => {
  const reader = async () => {
    throw new Error('not called');
  };

  it('polls, so an open tab does not hold a stale "Quiet now" indefinitely', () => {
    const options = quietHoursQueryOptions('mb-1', reader);
    expect(options.refetchInterval).toBeTypeOf('number');
    expect(options.refetchInterval).toBeGreaterThan(0);
    expect(options.refetchIntervalInBackground).toBe(false);
  });
});
