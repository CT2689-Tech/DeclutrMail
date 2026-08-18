import { describe, expect, it } from 'vitest';

import { firstTriageQueryOptions, onboardingStateQueryOptions } from './query-options';

const unusedReader = () => Promise.reject(new Error('reader must not run in this test'));

describe('onboarding query options', () => {
  it('keeps hydrated staleTime at or above the 30s server-to-mount budget (D200)', () => {
    // These reads are server-prefetched behind up to three serial awaits
    // in ServerOnboardingBoundary. A staleTime below the realistic
    // prefetch-to-observer-mount gap makes the client re-fetch the
    // just-hydrated payload on mount — the waterfall D200 removes.
    expect(firstTriageQueryOptions(unusedReader as never).staleTime).toBeGreaterThanOrEqual(30_000);
    expect(onboardingStateQueryOptions(unusedReader as never).staleTime).toBeGreaterThanOrEqual(
      30_000,
    );
  });
});
