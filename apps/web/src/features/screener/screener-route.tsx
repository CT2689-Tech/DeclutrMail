'use client';

import { TierGate } from '@/features/billing/tier-gate';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { screenerGateCount } from './gate-copy';
import { useScreenerCount, useScreenerQueue } from './api/use-screener';
import { composeScreenerState } from './compose-state';
import { ScreenerScreen } from './screener-screen';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Under-tier copy for /screener. Honours D194: the Screener COLLECTS
 * new senders for review — it never claims to keep them out of the
 * inbox (D72 soft quarantine; Gmail untouched until the user decides).
 * The footnote names the deferred-decision path the current plan keeps
 * (the Later verb in Triage) so the basic queue isn't hidden.
 *
 * Exported for the D194 copy test.
 */
export const SCREENER_GATE_COPY = {
  title: 'Screener',
  pitch: WS2_COPY.locked.screener.pitch,
  footnote: WS2_COPY.locked.screener.footnote,
} as const;

/**
 * The shared paywall (`TierGate`) rather than a bespoke upsell: the
 * plan name, price, checkout link and money-back note all derive from
 * the manifest there, and the queue's reads never mount under-tier.
 */
export function ScreenerRoute({ newSenderCount = null }: { newSenderCount?: number | null }) {
  const countLine = screenerGateCount(newSenderCount);
  return (
    <TierGate
      capability="screener"
      title={SCREENER_GATE_COPY.title}
      pitch={
        countLine == null ? (
          SCREENER_GATE_COPY.pitch
        ) : (
          <>
            {SCREENER_GATE_COPY.pitch} {countLine}
          </>
        )
      }
      footnote={SCREENER_GATE_COPY.footnote.replaceAll('{freeName}', TIER_MANIFEST.free.name)}
    >
      <ScreenerQueueRoute />
    </TierGate>
  );
}

function ScreenerQueueRoute() {
  const hydrated = useHydrated();
  const queue = useScreenerQueue();
  const count = useScreenerCount();
  const state = composeScreenerState({
    rows: queue.data,
    isLoading: queue.isLoading,
    isError: queue.isError,
    error: queue.error,
    retry: () => void queue.refetch(),
  });
  // The sidebar can populate this shared count before the route hydrates.
  // SSR and the matching first browser render must both omit the live total.
  return (
    <ScreenerScreen
      state={state}
      totalPending={hydrated ? (count.data?.pending ?? null) : null}
      refreshFailed={queue.isError && queue.data !== undefined}
      onRefresh={() => void queue.refetch()}
    />
  );
}
