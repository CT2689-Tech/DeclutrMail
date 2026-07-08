import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { hasAnalyticsConsent, readStoredConsent, storeConsent } from '@/lib/cookie-consent';
import { CookieConsentBanner } from './cookie-consent-banner';

function clearStoredConsent(): void {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
}

describe('CookieConsentBanner (D147)', () => {
  beforeEach(clearStoredConsent);

  it('shows the D147 copy and both choices on first visit', async () => {
    render(<CookieConsentBanner />);
    const banner = await screen.findByTestId('cookie-consent-banner');

    expect(banner).toHaveTextContent('We use essential cookies for sign-in and billing.');
    expect(banner).toHaveTextContent(
      'Help us improve DeclutrMail? We use PostHog to understand which features matter. We never see your inbox content.',
    );
    expect(screen.getByRole('button', { name: 'Accept all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Essential only' })).toBeInTheDocument();
  });

  it('"Essential only" hides the banner and stores the decline — analytics stays off', async () => {
    render(<CookieConsentBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Essential only' }));

    expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
    expect(readStoredConsent()).toBe('essential');
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('"Accept all" hides the banner and grants analytics consent', async () => {
    render(<CookieConsentBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept all' }));

    expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
    expect(readStoredConsent()).toBe('all');
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it('retires live when another surface stores the choice (the D147 preferences card)', async () => {
    render(<CookieConsentBanner />);
    await screen.findByTestId('cookie-consent-banner');

    // The cookie-preferences card calls storeConsent; the banner must
    // hear the change event and retire without a remount.
    act(() => storeConsent('essential'));

    expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
  });

  it('never returns once a choice is stored (fresh mount stays empty)', async () => {
    const first = render(<CookieConsentBanner />);
    fireEvent.click(await first.findByRole('button', { name: 'Essential only' }));
    first.unmount();

    render(<CookieConsentBanner />);
    // The visibility check runs in a post-mount effect; give it a tick
    // and assert the banner still never appeared.
    await waitFor(() => {
      expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
    });
  });
});
