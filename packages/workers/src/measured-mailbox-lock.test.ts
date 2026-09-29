import { afterEach, describe, expect, it, vi } from 'vitest';
import { measuredMailboxLock } from './measured-mailbox-lock.js';
afterEach(() => vi.restoreAllMocks());
describe('lock timing telemetry', () => {
  it('separates wait and hold without identifiers and preserves cleanup on failure', async () => {
    let now = 0;
    let released = false;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const emit = vi.fn();
    const lock = measuredMailboxLock(
      {
        run: async (_, fn) => {
          now += 1100;
          try {
            return await fn();
          } finally {
            released = true;
          }
        },
      },
      emit,
    );
    await expect(
      lock.run('private-mailbox', async () => {
        now += 1500;
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(released).toBe(true);
    expect(emit).toHaveBeenCalledExactlyOnceWith({ lockWaitMs: 1100, lockHoldMs: 1500 });
  });
  it('does not log fast locks', async () => {
    const emit = vi.fn();
    const lock = measuredMailboxLock({ run: (_, fn) => fn() }, emit);
    expect(await lock.run('private-mailbox', async () => 42)).toBe(42);
    expect(emit).not.toHaveBeenCalled();
  });
});
