import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CONSENT_CHANGE_EVENT } from '@/lib/cookie-consent';

const { identifySpy } = vi.hoisted(() => ({ identifySpy: vi.fn() }));

vi.mock('@/lib/posthog', () => ({ identifyUser: identifySpy }));

import { AnalyticsIdentityBridge, useAnalyticsIdentity } from './analytics-identity-bridge';
import { analyticsContext } from '@/lib/analytics-context';
import type { Tier } from './api/use-me';

function CurrentIdentity({ id, tier }: { id: string; tier?: Tier }) {
  useAnalyticsIdentity(id, null, tier);
  return null;
}

describe('AnalyticsIdentityBridge', () => {
  it('binds current tier changes and clears unavailable or unmounted account context', () => {
    const { rerender, unmount } = render(<CurrentIdentity id="internal-a" tier="pro" />);
    expect(analyticsContext().plan_tier).toBe('pro');
    rerender(<CurrentIdentity id="internal-a" tier="free" />);
    expect(analyticsContext().plan_tier).toBe('free');
    rerender(<CurrentIdentity id="internal-b" />);
    expect(analyticsContext().plan_tier).toBe('unknown');
    rerender(<CurrentIdentity id="internal-b" tier="plus" />);
    expect(analyticsContext().plan_tier).toBe('plus');
    unmount();
    expect(analyticsContext().plan_tier).toBe('unknown');
  });
  it('identifies by internal UUID on mount and retries when consent changes', () => {
    const { unmount } = render(<AnalyticsIdentityBridge userId="user-internal-1" />);

    expect(identifySpy).toHaveBeenCalledWith('user-internal-1');
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    expect(identifySpy).toHaveBeenCalledTimes(2);

    unmount();
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    expect(identifySpy).toHaveBeenCalledTimes(2);
  });
});
