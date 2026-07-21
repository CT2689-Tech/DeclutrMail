'use client';

/**
 * Billing read hooks (D119) — `GET /api/billing/subscription`.
 *
 * The endpoint 503s with `BILLING_DISABLED` until the founder flips
 * `BILLING_ENABLED=true` (F-queue step). That is a DESIGNED state, not
 * a failure: `retry: false` so the 503 surfaces immediately, and
 * `billingDisabledFrom` lets the screen branch to the honest
 * "billing isn't live yet" card instead of an error toast.
 */

import { useQuery } from '@tanstack/react-query';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { apiGet, ApiError } from '@/lib/api/client';

import { billingKeys } from './query-keys';

/** Extract the machine-readable envelope code from an ApiError. */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { error?: { code?: unknown } } | undefined;
  const code = body?.error?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Extract one scalar from the envelope's `details` (e.g. the billing
 * adapters' `providerOutcome: 'definitive'` marker — set only when the
 * provider itself REJECTED the call, i.e. the outcome is known).
 */
export function apiErrorDetail(error: unknown, key: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { error?: { details?: Record<string, unknown> } } | undefined;
  const value = body?.error?.details?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * True when the error is the 503 "billing is dark" designed state
 * (`BILLING_DISABLED` — module loaded, env flag off).
 */
export function isBillingDisabledError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 503 && apiErrorCode(error) === 'BILLING_DISABLED'
  );
}

export function useBillingSubscription(options?: {
  /**
   * Poll cadence for the post-checkout "payment processing" state —
   * the ONLY sanctioned repeat-read: a success-path 200 poll while the
   * webhook grant is in flight, never an error retry.
   */
  refetchInterval?: number | false;
}) {
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<BillingSubscription>('/api/billing/subscription', { signal });
      return envelope.data;
    },
    // 503 BILLING_DISABLED is a designed state — never hammer it (§8
    // read-guard-4xx/5xx rule; the route fails CLEANLY while dark).
    retry: false,
    staleTime: 60_000,
    refetchInterval: options?.refetchInterval ?? false,
  });
}
