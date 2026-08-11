/**
 * D38 verb-tour flag — the FE side of POST /api/onboarding/verb-tour.
 *
 * The flag rides `GET /api/onboarding/state` (already user-scoped and
 * already fetched by the onboarding flow), so replaying from Settings
 * needs no second read and no mailbox.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OnboardingState } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';
import { ONBOARDING_STATE_KEY, useOnboardingState } from '@/features/onboarding/api/use-onboarding';

export interface VerbTourState {
  /** True once the tour has been finished or dismissed (D38). */
  completed: boolean;
  isPending: boolean;
  isError: boolean;
}

export function useVerbTourState(): VerbTourState {
  const state = useOnboardingState();
  return {
    // Unknown reads as COMPLETED so the tour never flashes onto the
    // screen and then vanishes when the real flag arrives. A returning
    // user seeing education chrome for a frame is the failure D38
    // rules out ("Day 2+: no re-education").
    completed: state.data ? state.data.verbTourCompletedAt !== null : true,
    isPending: state.isPending,
    isError: state.isError,
  };
}

/**
 * Mark the tour seen — written by both finishing and dismissing, since
 * D38 makes the escape hatch as permanent as completion.
 *
 * Write-through on success so the tour disappears in the same tick as
 * the click, without waiting on a refetch.
 */
export function useMarkVerbTourSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<OnboardingState> => {
      const envelope = await apiPost<OnboardingState>('/api/onboarding/verb-tour', {});
      return envelope.data;
    },
    onSuccess: (state) => {
      qc.setQueryData(ONBOARDING_STATE_KEY, state);
    },
  });
}
