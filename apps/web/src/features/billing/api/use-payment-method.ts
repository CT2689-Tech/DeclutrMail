'use client';

/**
 * D119 / ADR-0035 — mint a payment-method session and go there.
 *
 * A mutation whose result may not be cached: the URL is short-lived,
 * customer-specific and authenticates its bearer (ADR-0035 §4).
 * Navigation is `window.location.assign` — the URL only exists after an
 * await, so `window.open` would be popup-blocked; same-tab navigation
 * never is, and the customer returns here after Paddle's form.
 *
 * Deliberately NO cache invalidation before leaving: the navigation
 * tears the JS context down, so a pre-navigation invalidate never gets
 * to refetch (gate network 2026-08-16). Freshness on RETURN is the
 * billing screen's job — its pageshow handler invalidates the billing
 * keys when the page is restored from the back/forward cache, the one
 * return path that would otherwise show the pre-portal state.
 *
 * The `unsupported` arm resolves normally — it is a 200 and an answer
 * (Razorpay has no self-serve path), so it must not land in `error`
 * where the UI would offer a retry that can never succeed. The caller
 * reads the resolved value and renders the support-assisted state.
 */

import { useMutation } from '@tanstack/react-query';
import { PaymentMethodSessionSchema } from '@declutrmail/shared/contracts';
import type { PaymentMethodSession } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

import { BillingPayloadError } from '../billing-model';

export function usePaymentMethodSession() {
  return useMutation<PaymentMethodSession, Error, void>({
    mutationFn: async () => {
      const envelope = await apiPost<unknown>('/api/billing/payment-method/session', {});
      const parsed = PaymentMethodSessionSchema.safeParse(envelope.data);
      if (!parsed.success) {
        throw new BillingPayloadError('POST /api/billing/payment-method/session');
      }
      return parsed.data;
    },
    onSuccess: (session) => {
      if (session.kind !== 'url') return;
      window.location.assign(session.url);
    },
  });
}
