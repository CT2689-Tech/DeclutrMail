import { queryOptions } from '@tanstack/react-query';
import type { OnboardingState } from '@declutrmail/shared/contracts';

import { TRIAGE_BOOTSTRAP_KEY } from '@/features/triage/api/query-options';
import type { FirstTriageRead } from './use-onboarding';

export const ONBOARDING_STATE_KEY = ['onboarding', 'state'] as const;
export const FIRST_TRIAGE_KEY = [...TRIAGE_BOOTSTRAP_KEY, 'onboarding-first'] as const;

type OnboardingReader<T> = (signal: AbortSignal) => Promise<T>;

export function onboardingStateQueryOptions(reader: OnboardingReader<OnboardingState>) {
  return queryOptions({
    queryKey: ONBOARDING_STATE_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}

export function firstTriageQueryOptions(reader: OnboardingReader<FirstTriageRead>) {
  return queryOptions({
    queryKey: FIRST_TRIAGE_KEY,
    queryFn: ({ signal }) => reader(signal),
    // Must exceed the server-prefetch-to-observer-mount gap: the
    // onboarding boundary settles this read up to three serial awaits
    // before the step-5 hook subscribes, so a 5s budget re-fetched the
    // just-hydrated payload on slower loads (D200).
    staleTime: 30_000,
  });
}
