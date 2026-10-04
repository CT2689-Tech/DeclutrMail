'use client';

import { ApiError } from '@/lib/api/client';
import { captureFeatureException } from '@/lib/sentry';

const OPERATIONS = [
  'checkout',
  'change-plan',
  'cancel',
  'resume-cancellation',
  'pause',
  'resume',
  'payment-method',
  'reconcile',
  'invoice-document',
] as const;

type BillingMutationOperation = (typeof OPERATIONS)[number];
const REPORT_WINDOW_MS = 60_000;
const lastReportedAt = new Map<BillingMutationOperation, number>();

/** Static operation labels only; no mutation variables or provider URLs. */
export function billingMutationFailure(operation: BillingMutationOperation) {
  return (error: unknown): void => {
    if (!OPERATIONS.includes(operation)) return;
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) return;
    if (error instanceof Error && error.name === 'AbortError') return;

    const now = Date.now();
    const previous = lastReportedAt.get(operation);
    if (previous !== undefined && now - previous < REPORT_WINDOW_MS) return;
    lastReportedAt.set(operation, now);
    // The lightweight facade is fire-and-forget and contains SDK/transport
    // failures. The mutation still rejects with its original error.
    captureFeatureException(error, { surface: 'billing', reason: operation });
  };
}
