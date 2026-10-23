'use client';

import { TierGate } from '@/features/billing/tier-gate';
import { useOnboardingState } from '@/features/onboarding/api/use-onboarding';
import { useTriageQueue, useTriageStats } from '@/features/triage/api/use-triage-queue';
import { composeTriageState } from '@/features/triage/compose-state';
import { TriageScreen } from '@/features/triage/triage-screen';

/** Existing suggested queue and action owner, with a simpler review presentation. */
export function SuggestedGuidedReview({ active, onExit }: { active: boolean; onExit: () => void }) {
  return (
    <TierGate
      capability="triage"
      title="Guided Review"
      pitch="Review suggested senders with a preview before Gmail changes."
    >
      <SuggestedReview active={active} onExit={onExit} />
    </TierGate>
  );
}
function SuggestedReview({ active, onExit }: { active: boolean; onExit: () => void }) {
  const onboarding = useOnboardingState();
  const queue = useTriageQueue();
  const stats = useTriageStats();
  const state = composeTriageState({
    rows: queue.data,
    stats: stats.data,
    isLoading: queue.isLoading || stats.isLoading,
    isError: queue.isError || stats.isError,
    error: queue.error ?? stats.error,
    retry: () => {
      void queue.refetch();
      void stats.refetch();
    },
  });
  return (
    <TriageScreen
      state={state}
      onboardedAt={onboarding.data?.onboardedAt ?? null}
      presentation="guided"
      active={active}
      onExitGuided={onExit}
    />
  );
}
