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

import { billingSubscriptionQueryOptions } from './query-options';
import { parseBillingSubscription } from './parse-payload';

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
   * Poll cadence for the two states that WAIT on something server-side:
   * the post-checkout "payment processing" window, and the D253
   * refund-settling window. Both are success-path 200 polls while a
   * provider outcome is in flight — never an error retry.
   *
   * The function form is accepted because the settling state is a
   * property of the data this very query returns, so the caller cannot
   * know it before the query exists. TanStack hands the query in, and
   * `refetchIntervalInBackground` is left at its default so either poll
   * runs only while the tab is focused.
   */
  refetchInterval?:
    | number
    | false
    | ((query: { state: { data: BillingSubscription | undefined } }) => number | false);
}) {
  return useQuery({
    ...billingSubscriptionQueryOptions(async (signal) => {
      const envelope = await apiGet<unknown>('/api/billing/subscription', { signal });
      return parseBillingSubscription(envelope.data);
    }),
    refetchInterval: options?.refetchInterval ?? false,
  });
}
