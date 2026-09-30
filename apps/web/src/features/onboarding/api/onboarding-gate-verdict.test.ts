import { describe, expect, it } from 'vitest';

import { onboardingGateVerdict } from './use-onboarding';

const DONE = { onboardedAt: '2026-01-02T00:00:00.000Z' };
const UNFINISHED = { onboardedAt: null };

describe('onboardingGateVerdict', () => {
  it.each([
    ['no answer yet', undefined, false, 'resolving'],
    ['a failed first read (fail-open)', undefined, true, 'open'],
    ['unfinished onboarding', UNFINISHED, false, 'gating'],
    // The gate still redirects on kept data, so nothing may treat the
    // failed refetch as "done" and use a result the gate is carrying.
    ['unfinished onboarding, then a failed refetch', UNFINISHED, true, 'gating'],
    ['finished onboarding', DONE, false, 'open'],
    ['finished onboarding, then a failed refetch', DONE, true, 'open'],
  ] as const)('%s', (_label, data, isError, verdict) => {
    expect(onboardingGateVerdict({ data, isError })).toBe(verdict);
  });
});
