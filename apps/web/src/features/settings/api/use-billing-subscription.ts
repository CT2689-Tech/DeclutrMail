/**
 * `useBillingSubscription` — GET /api/billing/subscription (D117).
 *
 * Backs the Settings "Plan & Billing" summary card. USER/workspace-
 * scoped. The endpoint 503s while `BILLING_ENABLED` is unset (the
 * pre-launch posture) — callers must render that as a designed
 * "plan info unavailable" state, never a fake "Free" (no fake billing
 * state, CLAUDE.md §10). 4xx/5xx are not retried beyond TanStack's
 * default cap; a 503 is deterministic so retrying is noise.
 */

import { useQuery } from '@tanstack/react-query';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { apiGet, ApiError } from '@/lib/api/client';

export const BILLING_SUBSCRIPTION_QUERY_KEY = ['billing', 'subscription'] as const;

export function useBillingSubscription() {
  return useQuery({
    queryKey: BILLING_SUBSCRIPTION_QUERY_KEY,
    queryFn: async (): Promise<BillingSubscription> => {
      const env = await apiGet<BillingSubscription>('/api/billing/subscription');
      return env.data;
    },
    retry: (failureCount, error) => {
      // 4xx/503 are designed states (billing disabled, no sub) — show
      // them, don't hammer the endpoint.
      if (error instanceof ApiError && error.status < 500) return false;
      if (error instanceof ApiError && error.status === 503) return false;
      return failureCount < 2;
    },
    staleTime: 60_000,
  });
}
