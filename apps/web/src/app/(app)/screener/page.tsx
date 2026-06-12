'use client';

// /screener — the Screener queue (D71–D77).
//
// Soft-quarantine review surface for first-time senders (D72 — Gmail
// untouched until the user decides). "Screener" is the product noun
// (D227-allowed); the verbs are the canonical K/A/U/L/D set. Pro-only
// per D77: under-tier workspaces see the upgrade surface and never
// fire a Screener query (the BE 402s them regardless — defense in
// depth).

import { hasCapability } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { useScreenerQueue } from '@/features/screener/api/use-screener';
import { composeScreenerState } from '@/features/screener/compose-state';
import { ScreenerProUpsell } from '@/features/screener/pro-upsell';
import { ScreenerScreen } from '@/features/screener/screener-screen';

/**
 * Hard navigation to /pricing — it lives in the (marketing) route
 * group, outside the (app) shell (same pattern as the Triage screen's
 * upgrade path).
 */
function openPricing(): void {
  window.location.assign('/pricing');
}

export default function ScreenerPage() {
  const { tier } = useTier();
  const unlocked = hasCapability(tier, 'screener');

  if (!unlocked) {
    return <ScreenerProUpsell onSeePricing={openPricing} />;
  }
  return <ScreenerQueueRoute />;
}

/**
 * Split out so the queue query only mounts for unlocked tiers — a
 * Free/Plus session must never fire a request the server would 402
 * (`useQuery` hooks would otherwise run before the gate).
 */
function ScreenerQueueRoute() {
  const queue = useScreenerQueue();
  const state = composeScreenerState({
    rows: queue.data,
    isLoading: queue.isLoading,
    isError: queue.isError,
    error: queue.error,
    retry: () => {
      void queue.refetch();
    },
  });
  return <ScreenerScreen state={state} />;
}
