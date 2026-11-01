'use client';

/**
 * The server's record of ONE checkout attempt — `GET /api/billing/checkout/:id`.
 *
 * The subscription read names only the workspace's latest attempt, so a
 * browser hold on an older one is checked here by its own id. Asked once
 * per key and never retried: an answer that proves nothing keeps the
 * hold. Not tied to the subscription poll, which used to abort a slow
 * check on every tick. Bounded, so a hung read lands as an error and the
 * hold shows its notice instead of a silent lock.
 */

import { useQuery } from '@tanstack/react-query';
import type { CheckoutAttempt } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';

import { billingKeys } from './query-keys';

const CHECK_TIMEOUT_MS = 10_000;

export function useCheckoutAttemptCheck(
  workspaceId: string,
  attemptId: string | undefined,
  absenceIsFinal: boolean,
) {
  return useQuery<CheckoutAttempt>({
    queryKey: billingKeys.checkoutAttempt(workspaceId, attemptId ?? '', absenceIsFinal),
    enabled: attemptId !== undefined,
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const forward = () => controller.abort(signal.reason);
      signal.addEventListener('abort', forward, { once: true });
      const timer = setTimeout(
        () => controller.abort(new DOMException('Checkout check timed out', 'TimeoutError')),
        CHECK_TIMEOUT_MS,
      );
      try {
        const envelope = await apiGet<CheckoutAttempt>(`/api/billing/checkout/${attemptId}`, {
          signal: controller.signal,
          networkAttempts: 1,
        });
        return envelope.data;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', forward);
      }
    },
  });
}
