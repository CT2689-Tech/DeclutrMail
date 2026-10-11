import { afterEach, expect, it, vi } from 'vitest';
import {
  clearPendingCheckout,
  pendingCheckoutKey,
  readPendingCheckout,
  withMoneyActionMutex,
  writePendingCheckout,
} from './pending-checkout';
afterEach(() => {
  vi.restoreAllMocks();
  clearPendingCheckout('mutex-fixture');
  delete (navigator as unknown as { locks?: unknown }).locks;
});
it('awaits asynchronous fallback work and propagates its rejection', async () => {
  let resolve!: (value: number) => void;
  const task = new Promise<number>((r) => {
    resolve = r;
  });
  let done = false;
  const run = withMoneyActionMutex('mutex-fixture', () => task).then((result) => {
    done = true;
    return result;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  resolve(7);
  expect(await run).toEqual({ acquired: true, result: 7 });
  await expect(
    withMoneyActionMutex('mutex-fixture', async () => {
      throw new Error('loader');
    }),
  ).rejects.toThrow('loader');
});
it('holds the cross-tab lock until asynchronous work settles', async () => {
  let locked = false;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        fn: (lock: unknown) => Promise<unknown>,
      ) => {
        if (locked) return fn(null);
        locked = true;
        try {
          return await fn({});
        } finally {
          locked = false;
        }
      },
    },
  });
  let resolve!: () => void;
  const first = withMoneyActionMutex(
    'mutex-fixture',
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const second = vi.fn();
  expect(await withMoneyActionMutex('mutex-fixture', second)).toEqual({ acquired: false });
  expect(second).not.toHaveBeenCalled();
  expect(locked).toBe(true);
  resolve();
  await first;
  expect(locked).toBe(false);
});
it('retains this tab’s attempt if storage writes fail, but explicit release clears it', () => {
  const writeSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  const record = writePendingCheckout(
    'mutex-fixture',
    'checkout_intent',
    'free',
    null,
    'pro',
    'annual',
    'attempt',
  );
  expect(readPendingCheckout('mutex-fixture')).toEqual(record);
  clearPendingCheckout('mutex-fixture');
  expect(readPendingCheckout('mutex-fixture')).toBeNull();
  writeSpy.mockRestore();
});
it('falls back on a read exception, but never resurrects a successfully stored record removed by another tab', () => {
  writePendingCheckout(
    'mutex-fixture',
    'checkout_intent',
    'free',
    null,
    'pro',
    'annual',
    'attempt',
  );
  const read = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  expect(readPendingCheckout('mutex-fixture')?.attemptId).toBe('attempt');
  read.mockRestore();
  localStorage.removeItem(pendingCheckoutKey('mutex-fixture'));
  expect(readPendingCheckout('mutex-fixture')).toBeNull();
});
