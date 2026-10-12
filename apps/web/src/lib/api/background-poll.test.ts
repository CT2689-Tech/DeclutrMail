import { afterEach, describe, expect, it } from 'vitest';

import { screenerCountQueryOptions } from '@/features/screener/api/query-options';
import { laterRecoveryQueryOptions } from '@/features/snoozed/api/query-options';

import { ApiError } from './client';
import { backgroundPollPaused, backgroundRefetchInterval } from './background-poll';
import { retryTransientOnly } from './retry';

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

describe('background polls', () => {
  it('keeps the interval while the tab is visible and online', () => {
    setVisibility('visible');
    setOnline(true);
    expect(backgroundPollPaused()).toBe(false);
    expect(backgroundRefetchInterval(60_000)).toBe(60_000);
  });

  it('pauses while the tab is hidden', () => {
    setVisibility('hidden');
    setOnline(true);
    expect(backgroundRefetchInterval(60_000)).toBe(false);
  });

  it('pauses while the browser is offline', () => {
    setVisibility('visible');
    setOnline(false);
    expect(backgroundRefetchInterval(60_000)).toBe(false);
  });
});

describe('screener count and Later recovery polls', () => {
  function intervalOf(options: { refetchInterval?: unknown }): number | false | undefined {
    const interval = options.refetchInterval;
    return typeof interval === 'function' ? interval({} as never) : (interval as number | false);
  }

  it('retries a dropped read and pauses while hidden or offline', () => {
    const screener = screenerCountQueryOptions(async () => ({ pending: 0 }));
    const later = laterRecoveryQueryOptions((async () => {
      throw new Error('not called');
    }) as never);
    expect(screener.retry).toBe(retryTransientOnly);
    expect(later.retry).toBe(retryTransientOnly);
    expect(retryTransientOnly(1, new ApiError(409, {}, 'guard'))).toBe(false);
    expect(retryTransientOnly(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryTransientOnly(3, new TypeError('Failed to fetch'))).toBe(false);

    setVisibility('visible');
    setOnline(true);
    expect(intervalOf(screener)).toBe(60_000);
    expect(intervalOf(later)).toBe(60_000);
    setVisibility('hidden');
    expect(intervalOf(screener)).toBe(false);
    expect(intervalOf(later)).toBe(false);
    setVisibility('visible');
    setOnline(false);
    expect(intervalOf(screener)).toBe(false);
    expect(intervalOf(later)).toBe(false);
  });
});
