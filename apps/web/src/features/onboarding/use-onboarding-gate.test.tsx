import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock('./api/use-onboarding', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOnboardingState: () => ({ data: { onboardedAt: null }, isError: false }),
}));
vi.mock('./onboarding-return-to', () => {
  throw new Error('Synthetic missing helper chunk');
});

import { useOnboardingGate } from './use-onboarding-gate';

beforeEach(() => h.replace.mockClear());
describe('onboarding navigation recovery', () => {
  it('opens plain onboarding when its destination helper cannot load', async () => {
    const { result } = renderHook(() => useOnboardingGate());
    expect(result.current.gating).toBe(true);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/onboarding'));
  });
  it('keeps account controls exempt even when the helper is unavailable', () => {
    const { result } = renderHook(() => useOnboardingGate({ exempt: true }));
    expect(result.current).toEqual({ gating: false, resolving: false });
    expect(h.replace).not.toHaveBeenCalled();
  });
});
