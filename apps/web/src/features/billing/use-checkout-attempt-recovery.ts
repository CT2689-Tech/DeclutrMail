'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  CheckoutAttempt,
  CheckoutSession,
  BillingReconcileResponse,
} from '@declutrmail/shared/contracts';
import { apiPost } from '@/lib/api/client';
import { launchCheckout } from './checkout';
export function useCheckoutAttemptRecovery(
  attempt: CheckoutAttempt,
  ownerId: string,
  onUpdated: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoStopped, setAutoStopped] = useState(false);
  const current = useRef({ id: attempt.id, ownerId });
  current.current = { id: attempt.id, ownerId };
  const refresh = useRef(onUpdated);
  refresh.current = onUpdated;
  const mounted = useRef(true);
  const actionRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    setBusy(false);
    setError(null);
    const controller = new AbortController();
    let checking = false;
    const id = attempt.id;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 15_000;
    setAutoStopped(false);
    const check = async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        await apiPost<BillingReconcileResponse>(
          '/api/billing/reconcile',
          { attemptId: id },
          { signal: controller.signal },
        );
        if (
          !controller.signal.aborted &&
          current.current.ownerId === ownerId &&
          current.current.id === id
        )
          refresh.current();
      } catch {
        // The user can still check or return; an outage never unlocks purchase.
      } finally {
        checking = false;
        if (!controller.signal.aborted) {
          if (Date.now() - started >= 15 * 60_000) setAutoStopped(true);
          else {
            timer = setTimeout(() => void check(), delay);
            delay = Math.min(delay * 2, 60_000);
          }
        }
      }
    };
    void check();
    return () => {
      mounted.current = false;
      actionRequest.current?.abort();
      actionRequest.current = null;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [attempt.id, ownerId]);

  async function act(action: 'check' | 'resume' | 'cancel') {
    if (actionRequest.current) return;
    const id = attempt.id;
    const request = new AbortController();
    actionRequest.current = request;
    const same = () =>
      mounted.current &&
      !request.signal.aborted &&
      current.current.id === id &&
      current.current.ownerId === ownerId;
    setBusy(true);
    setError(null);
    try {
      if (action === 'check')
        await apiPost('/api/billing/reconcile', { attemptId: id }, { signal: request.signal });
      else if (action === 'cancel')
        await apiPost(
          `/api/billing/checkout/${id}/cancel`,
          { version: attempt.version },
          { signal: request.signal },
        );
      else {
        const response = await apiPost<CheckoutSession>(
          `/api/billing/checkout/${id}/resume`,
          {
            version: attempt.version,
          },
          { signal: request.signal },
        );
        if (same())
          await launchCheckout(
            response.data,
            {
              onCompleted: () => {
                if (same()) refresh.current();
              },
              onClosed: () => {
                if (same()) refresh.current();
              },
            },
            same,
          );
      }
      if (same()) refresh.current();
    } catch {
      if (same())
        setError(
          action === 'resume'
            ? 'Checkout could not open. You can check its payment status.'
            : action === 'cancel'
              ? 'Cancellation is not confirmed. Check payment status before trying again.'
              : 'Payment status could not be checked. Please try again.',
        );
    } finally {
      if (actionRequest.current === request) {
        actionRequest.current = null;
        if (same()) setBusy(false);
      }
    }
  }
  return { busy, error, autoStopped, act };
}
