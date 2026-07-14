import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CONSENT_CHANGE_EVENT } from '@/lib/cookie-consent';

const { identifySpy } = vi.hoisted(() => ({ identifySpy: vi.fn() }));

vi.mock('@/lib/posthog', () => ({ identifyUser: identifySpy }));

import { AnalyticsIdentityBridge } from './analytics-identity-bridge';

describe('AnalyticsIdentityBridge', () => {
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
