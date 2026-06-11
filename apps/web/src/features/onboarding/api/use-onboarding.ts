/**
 * Onboarding API hooks (D106-D113) — TanStack Query bindings for the
 * `/api/onboarding/*` surface.
 *
 * Query-key note (D226 wiring): the first-triage key extends
 * `TRIAGE_QUEUE_KEY`, so the triage pipeline's
 * `invalidateAfterDecision` (which invalidates the `['triage','queue']`
 * PREFIX after a server-confirmed decision) refetches the practice
 * set too — the decided row leaves step 5 exactly the way it leaves
 * the production queue: on server confirmation, never optimistically.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OnboardingFirstTriageMetaSchema,
  type OnboardingFirstTriageMeta,
  type OnboardingPresetKey,
  type OnboardingPresetPicksResult,
  type OnboardingState,
} from '@declutrmail/shared/contracts';

import { apiGet, apiPost } from '@/lib/api/client';
import type { TriageDecisionRow } from '@/features/triage/data';
import { TRIAGE_QUEUE_KEY } from '@/features/triage/api/use-triage-queue';

export const ONBOARDING_STATE_KEY = ['onboarding', 'state'] as const;

/** Extends the triage-queue prefix on purpose — see module docblock. */
export const FIRST_TRIAGE_KEY = [...TRIAGE_QUEUE_KEY, 'onboarding-first'] as const;

export function useOnboardingState(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ONBOARDING_STATE_KEY,
    queryFn: async ({ signal }) => {
      const envelope = await apiGet<OnboardingState>('/api/onboarding/state', { signal });
      return envelope.data;
    },
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export interface FirstTriageRead {
  rows: TriageDecisionRow[];
  meta: OnboardingFirstTriageMeta;
}

export function useFirstTriage(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: FIRST_TRIAGE_KEY,
    queryFn: async ({ signal }): Promise<FirstTriageRead> => {
      const envelope = await apiGet<TriageDecisionRow[]>('/api/onboarding/first-triage', {
        signal,
      });
      return {
        rows: envelope.data,
        meta: OnboardingFirstTriageMetaSchema.parse(envelope.meta),
      };
    },
    enabled: opts.enabled ?? true,
    staleTime: 5_000,
  });
}

export function useSubmitPresetPicks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (presetKeys: OnboardingPresetKey[]) => {
      const envelope = await apiPost<OnboardingPresetPicksResult>('/api/onboarding/preset-picks', {
        presetKeys,
      });
      return envelope.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ONBOARDING_STATE_KEY });
    },
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { skipped?: boolean } = {}) => {
      const envelope = await apiPost<OnboardingState>('/api/onboarding/complete', input);
      return envelope.data;
    },
    onSuccess: (state) => {
      // Write-through so the redirect-out-of-onboarding effect sees
      // the completed state immediately (no refetch race).
      qc.setQueryData(ONBOARDING_STATE_KEY, state);
    },
  });
}
