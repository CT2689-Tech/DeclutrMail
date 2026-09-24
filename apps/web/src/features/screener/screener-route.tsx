'use client';

import { TierGate } from '@/features/billing/tier-gate';
import { useScreenerCount, useScreenerQueue } from './api/use-screener';
import { composeScreenerState } from './compose-state';
import { ScreenerScreen } from './screener-screen';

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
  pitch: 'Give each undecided sender a first review; their email keeps arriving until you choose.',
  footnote: 'You can still move any sender to Later from Triage.',
} as const;

/**
 * The shared paywall (`TierGate`) rather than a bespoke upsell: the
 * plan name, price, checkout link and money-back note all derive from
 * the manifest there, and the queue's reads never mount under-tier.
 */
export function ScreenerRoute() {
  return (
    <TierGate
      capability="screener"
      title={SCREENER_GATE_COPY.title}
      pitch={SCREENER_GATE_COPY.pitch}
      footnote={SCREENER_GATE_COPY.footnote}
    >
      <ScreenerQueueRoute />
    </TierGate>
  );
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
