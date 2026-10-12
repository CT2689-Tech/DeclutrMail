import { afterEach, describe, expect, it } from 'vitest';
import { quietHoursQueryOptions } from './query-options';

const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

afterEach(() => {
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  if (originalOnline) Object.defineProperty(navigator, 'onLine', originalOnline);
});

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

  function currentInterval(): number | false | undefined {
    const interval = quietHoursQueryOptions('mb-1', reader).refetchInterval;
    return typeof interval === 'function' ? interval({} as never) : interval;
  }

  it('polls, so an open tab does not hold a stale "Quiet now" indefinitely', () => {
    setVisibility('visible');
    setOnline(true);
    expect(quietHoursQueryOptions('mb-1', reader).refetchInterval).toBeTypeOf('function');
    expect(currentInterval()).toBeGreaterThan(0);
  });

  it('does not poll a hidden or offline tab', () => {
    setVisibility('hidden');
    setOnline(true);
    expect(currentInterval()).toBe(false);
    setVisibility('visible');
    setOnline(false);
    expect(currentInterval()).toBe(false);
  });
});
