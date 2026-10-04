import type { ReactNode } from 'react';
import type * as ApiClient from '@/lib/api/client';
import type * as SentryFacade from '@/lib/sentry';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiGet: mocks.get,
  apiPost: mocks.post,
}));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: mocks.capture }));

import { ApiError } from '@/lib/api/client';
import { makeQueryClient } from '@/lib/query-client';
import { billingMutationFailure } from './mutation-failure';
import { useCheckout } from './use-checkout';
import { useChangePlan } from './use-change-plan';
import { useCancelSubscription } from './use-cancel-subscription';
import { useResumeCancellation } from './use-resume-cancellation';
import { usePauseSubscription } from './use-pause-subscription';
import { useResumeSubscription } from './use-resume-subscription';
import { usePaymentMethodSession } from './use-payment-method';
import { useReconcileCheckout } from './use-reconcile-checkout';
import { useInvoiceDocument } from './use-invoices';

const PRIVATE = 'synthetic-private-reference';
const cases = [
  [
    'checkout',
    () => {
      const mutation = useCheckout();
      return () => mutation.mutateAsync({ tierId: 'plus', cycle: 'monthly', provider: 'paddle' });
    },
  ],
  [
    'change-plan',
    () => {
      const mutation = useChangePlan();
      return () => mutation.mutateAsync({ tierId: 'pro', cycle: 'annual' });
    },
  ],
  [
    'cancel',
    () => {
      const mutation = useCancelSubscription();
      return () => mutation.mutateAsync({ reason: 'other' });
    },
  ],
  [
    'resume-cancellation',
    () => {
      const mutation = useResumeCancellation();
      return () => mutation.mutateAsync();
    },
  ],
  [
    'pause',
    () => {
      const mutation = usePauseSubscription();
      return () => mutation.mutateAsync();
    },
  ],
  [
    'resume',
    () => {
      const mutation = useResumeSubscription();
      return () => mutation.mutateAsync();
    },
  ],
  [
    'payment-method',
    () => {
      const mutation = usePaymentMethodSession();
      return () => mutation.mutateAsync();
    },
  ],
  [
    'reconcile',
    () => {
      const mutation = useReconcileCheckout();
      return () => mutation.mutateAsync({});
    },
  ],
  [
    'invoice-document',
    () => {
      const mutation = useInvoiceDocument();
      return () => mutation.mutateAsync(PRIVATE);
    },
  ],
] as const;

let now = 1_800_000_000_000;
beforeEach(() => {
  now += 90_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.capture.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;
}

async function fail(hook: () => () => Promise<unknown>, error: Error) {
  mocks.get.mockRejectedValue(error);
  mocks.post.mockRejectedValue(error);
  const { result, unmount } = renderHook(hook, { wrapper });
  await act(async () => {
    await expect(result.current()).rejects.toBe(error);
  });
  unmount();
}

describe('billing mutation failures reach optional telemetry', () => {
  it.each(cases)(
    'reports %s without replacing the caller error or exposing variables',
    async (operation, hook) => {
      const error = new TypeError('Failed to fetch');
      await fail(hook, error);
      expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(error, {
        surface: 'billing',
        reason: operation,
      });
      expect(JSON.stringify(mocks.capture.mock.calls[0]?.[1])).not.toContain(PRIVATE);
    },
  );

  it('reports a 5xx failure while preserving its recovery error', async () => {
    const error = new ApiError(502, { error: { code: 'UPSTREAM_ERROR' } }, 'provider unavailable');
    await fail(cases[0][1], error);
    expect(mocks.capture).toHaveBeenCalledWith(error, { surface: 'billing', reason: 'checkout' });
  });

  it.each([400, 401, 402, 403, 404, 409, 422, 429])(
    'keeps designed HTTP %s states quiet',
    async (status) => {
      await fail(cases[0][1], new ApiError(status, {}, 'designed state'));
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );

  it('keeps explicit cancellation quiet', async () => {
    const error = new Error('Request canceled');
    error.name = 'AbortError';
    await fail(cases[0][1], error);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('throttles the same operation across hook instances and recovers at the boundary', async () => {
    const error = new TypeError('Failed to fetch');
    await fail(cases[0][1], error);
    await fail(cases[0][1], error);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    now += 60_000;
    await fail(cases[0][1], error);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
  });

  it('does not throttle a different operation', async () => {
    const error = new TypeError('Failed to fetch');
    await fail(cases[0][1], error);
    await fail(cases[2][1], error);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
  });

  it('refuses an operation supplied outside the closed vocabulary', () => {
    billingMutationFailure(PRIVATE as never)(new TypeError('Failed to fetch'));
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('preserves the mutation error with the actual facade disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const actual = await vi.importActual<typeof SentryFacade>('@/lib/sentry');
    mocks.capture.mockImplementation(actual.captureFeatureException);
    await fail(cases[0][1], new TypeError('Failed to fetch'));
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});
