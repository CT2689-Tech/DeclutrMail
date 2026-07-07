import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storeConsent } from './cookie-consent';
import { __resetForTests, identifyUser, track } from './posthog';

/**
 * D147 consent gate — the contract under test: PostHog must not
 * initialize or capture ANYTHING until the visitor stored an explicit
 * "Accept all" in the cookie banner. Decline (or silence) is the
 * default and means zero SDK activity.
 */

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

function clearStoredConsent(): void {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
}

beforeEach(() => {
  clearStoredConsent();
  __resetForTests();
  posthogMock.init.mockClear();
  posthogMock.capture.mockClear();
  posthogMock.identify.mockClear();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('track() consent gate (D147)', () => {
  it('does nothing while no consent choice is stored — decline by default', async () => {
    await track('page_viewed', { page: 'senders', mailbox_id: null });
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('does nothing after "Essential only"', async () => {
    storeConsent('essential');
    await track('page_viewed', { page: 'senders', mailbox_id: null });
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('after "Accept all": initializes once with the key and captures events', async () => {
    storeConsent('all');
    await track('page_viewed', { page: 'senders', mailbox_id: null });
    await track('page_viewed', { page: 'triage', mailbox_id: null });

    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
      }),
    );
    expect(posthogMock.capture).toHaveBeenCalledTimes(2);
    expect(posthogMock.capture).toHaveBeenCalledWith(
      'page_viewed',
      expect.objectContaining({ page: 'senders' }),
    );
  });

  it('consent granted mid-session takes effect on the NEXT call; earlier events are dropped, not queued', async () => {
    await track('page_viewed', { page: 'senders', mailbox_id: null });
    expect(posthogMock.capture).not.toHaveBeenCalled();

    storeConsent('all');
    await track('page_viewed', { page: 'triage', mailbox_id: null });

    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
    expect(posthogMock.capture).toHaveBeenCalledWith(
      'page_viewed',
      expect.objectContaining({ page: 'triage' }),
    );
  });

  it('stays a no-op without NEXT_PUBLIC_POSTHOG_KEY even after "Accept all"', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    storeConsent('all');
    await track('page_viewed', { page: 'senders', mailbox_id: null });
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});

describe('identifyUser() consent gate (D147)', () => {
  it('does not identify without consent', async () => {
    await identifyUser('11111111-1111-4111-8111-111111111111');
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });

  it('identifies (internal UUID) after "Accept all"', async () => {
    storeConsent('all');
    await identifyUser('11111111-1111-4111-8111-111111111111');
    expect(posthogMock.identify).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });
});
