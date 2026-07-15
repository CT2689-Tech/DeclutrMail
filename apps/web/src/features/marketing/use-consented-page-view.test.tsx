import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storeConsent } from '@/lib/cookie-consent';
import { useConsentedPageView } from './use-consented-page-view';

const h = vi.hoisted(() => ({ track: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/posthog', () => ({ track: h.track }));

function Harness({ page = 'landing' }: { page?: 'landing' | 'pricing' }) {
  useConsentedPageView(page);
  return null;
}

beforeEach(() => {
  h.track.mockClear();
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
});

describe('useConsentedPageView', () => {
  it('records the current first visit once when Accept all is chosen after mount', async () => {
    render(<Harness />);
    expect(h.track).not.toHaveBeenCalled();

    storeConsent('all');
    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith('page_viewed', {
        page: 'landing',
        mailbox_id: null,
      }),
    );

    storeConsent('all');
    expect(h.track).toHaveBeenCalledTimes(1);
  });

  it('records immediately when consent already exists and once again after a route change', () => {
    storeConsent('all');
    const { rerender } = render(<Harness />);
    expect(h.track).toHaveBeenCalledWith('page_viewed', { page: 'landing', mailbox_id: null });

    rerender(<Harness page="pricing" />);
    expect(h.track).toHaveBeenCalledWith('page_viewed', { page: 'pricing', mailbox_id: null });
    expect(h.track).toHaveBeenCalledTimes(2);
  });
});
