'use client';

/**
 * Checkout mutation (D117/D120) — `POST /api/billing/checkout`.
 *
 * The request body is the shared `CheckoutRequest` contract verbatim;
 * the response is the provider-discriminated `CheckoutSession` the
 * caller hands to `launchCheckout` (features/billing/checkout.ts).
 *
 * CHECKOUT NEVER GRANTS (CLAUDE.md §10 no-fake-completion): the tier
 * flips only when the provider webhook lands — the FE never assumes
 * success after opening the provider surface.
 */

import { useMutation } from '@tanstack/react-query';
import { CHECKOUT_GEO_HEADER } from '@declutrmail/shared/billing/checkout-geo-header';
import type { CheckoutRequest, CheckoutSession } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

import { billingMutationFailure } from './mutation-failure';

type CheckoutMutationInput = CheckoutRequest & { checkoutGeoToken?: string };

export function useCheckout() {
  return useMutation<CheckoutSession, Error, CheckoutMutationInput>({
    onError: billingMutationFailure('checkout'),
    mutationFn: async ({ checkoutGeoToken, ...body }) => {
      const envelope = await apiPost<CheckoutSession>('/api/billing/checkout', body, {
        headers: checkoutGeoToken ? { [CHECKOUT_GEO_HEADER]: checkoutGeoToken } : undefined,
      });
      return envelope.data;
    },
  });
}
