'use client';

import { hasCapability } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { useScreenerCount, useScreenerQueue } from './api/use-screener';
import { composeScreenerState } from './compose-state';
import { ScreenerUpsell } from './upsell';
import { ScreenerScreen } from './screener-screen';

function openPricing(): void {
  window.location.assign('/pricing');
}

export function ScreenerRoute() {
  const { tier } = useTier();
  if (!hasCapability(tier, 'screener')) {
    return <ScreenerUpsell onSeePricing={openPricing} />;
  }
  return <ScreenerQueueRoute />;
}

function ScreenerQueueRoute() {
  const queue = useScreenerQueue();
  const count = useScreenerCount();
  const state = composeScreenerState({
    rows: queue.data,
    isLoading: queue.isLoading,
    isError: queue.isError,
    error: queue.error,
    retry: () => void queue.refetch(),
  });
  return <ScreenerScreen state={state} totalPending={count.data?.pending ?? null} />;
}
