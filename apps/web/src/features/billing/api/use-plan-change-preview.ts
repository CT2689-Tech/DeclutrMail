'use client';

/**
 * Read-only plan-change dry run (D117/D120) —
 * `POST /api/billing/change-plan/preview`.
 *
 * The provider computes the exact immediate charge so the confirm panel
 * can state a number instead of "a prorated difference". `enabled`
 * gates the fetch to the upgrade panel being open; the result is never
 * cached across targets (each target/cycle pair is its own key) and a
 * failure blocks immediate confirmation until a fresh quote is available.
 */

import { PlanChangePreviewSchema } from '@declutrmail/shared/contracts';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  BillingCycle,
  PlanChangePreview,
  PurchasableTier,
} from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';

import { billingKeys } from './query-keys';

export function usePlanChangePreview(args: {
  tierId: PurchasableTier;
  cycle: BillingCycle;
  enabled: boolean;
}) {
  // A reopened preview must not adopt a response requested by a closed one.
  // Target/cycle isolate plan choices; this mount ID isolates review sessions.
  const previewSession = useId();
  return useQuery<PlanChangePreview>({
    queryKey: [...billingKeys.all, 'change-preview', args.tierId, args.cycle, previewSession],
    enabled: args.enabled,
    // The quote reflects live proration — a minute-old number can be
    // pennies stale but a re-open should re-ask.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    queryFn: async () => {
      const envelope = await apiPost<PlanChangePreview>('/api/billing/change-plan/preview', {
        tierId: args.tierId,
        cycle: args.cycle,
      });
      return PlanChangePreviewSchema.parse(envelope.data);
    },
  });
}
