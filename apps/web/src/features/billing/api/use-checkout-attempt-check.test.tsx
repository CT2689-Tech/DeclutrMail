import type { ReactNode } from 'react';
import type * as ApiClient from '@/lib/api/client';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiGet: mocks.get,
}));

import { makeQueryClient } from '@/lib/query-client';
import { useCheckoutAttemptCheck } from './use-checkout-attempt-check';

const ID = '33333333-3333-4333-8333-333333333333';

describe('useCheckoutAttemptCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('gives up on a check that never answers, so the hold can show its notice', async () => {
    // A hung read used to leave the hold silent: no notice, controls disabled.
    mocks.get.mockImplementation(
      (_path: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          }),
        ),
    );
    const client = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCheckoutAttemptCheck('w', ID, true), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(result.current.error).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect((result.current.error as DOMException | null)?.name).toBe('TimeoutError');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(
      `/api/billing/checkout/${ID}`,
      expect.objectContaining({ networkAttempts: 1 }),
    );
  });

  it('does not ask without an attempt', async () => {
    const client = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useCheckoutAttemptCheck('w', undefined, false), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
