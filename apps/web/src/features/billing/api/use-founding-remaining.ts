'use client';

/**
 * Founding Pro slot availability — `GET /api/billing/founding-remaining`
 * (QA-billing-20260901-09/-05).
 *
 * Disclosure only: the checkout guard's own read is still the
 * AUTHORITATIVE, race-safe gate (`BillingService.createCheckout`). This
 * hook exists so the plan card and the confirm checkbox can stop
 * offering a sold-out promo and discover it only at a 409.
 */

import { useQuery } from '@tanstack/react-query';
import type { FoundingAvailability } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';

import { billingKeys } from './query-keys';

export function useFoundingRemaining(enabled: boolean) {
  return useQuery<FoundingAvailability>({
    queryKey: billingKeys.foundingRemaining(),
    enabled,
    // A slow-moving count (250 total, ever) — no reason to re-ask often.
    staleTime: 60_000,
    retry: false,
    queryFn: async (context) => {
      const envelope = await apiGet<FoundingAvailability>('/api/billing/founding-remaining', {
        signal: context.signal,
      });
      return envelope.data;
    },
  });
}
