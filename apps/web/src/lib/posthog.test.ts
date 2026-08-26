import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasAnalyticsConsent, readStoredConsent, storeConsent } from './cookie-consent';
import {
  __resetForTests,
  __setSdkPromiseForTests,
  identifyUser,
  track,
  withdrawAnalyticsConsent,
} from './posthog';

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
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
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
  posthogMock.reset.mockClear();
  posthogMock.opt_out_capturing.mockClear();
  posthogMock.opt_in_capturing.mockClear();
  posthogMock.has_opted_out_capturing.mockClear();
  posthogMock.has_opted_out_capturing.mockReturnValue(false);
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
        // Must be the literal 'history_change': posthog-js gates its
        // HistoryAutocapture on that exact string, and plain `true` would
        // capture only the cold-load pageview — missing every client-side
        // App Router navigation.
        capture_pageview: 'history_change',
        capture_pageleave: true,
        disable_session_recording: true,
        // Kills the `/flags/` request, which is a PRIVACY guard, not a
        // preference. `sanitize_properties` covers captured events only;
        // the flags POST carries its own `person_properties` and bypasses
        // it entirely, so posthog-js shipped `$initial_current_url` built
        // from the raw address bar (`?sender_q=<address>` included) even
        // after the `/e/` scrub landed. Nothing reads a PostHog flag —
        // flags come from env (ADR-0025) — so the endpoint is pure leak
        // surface. Assert it here so a config refactor cannot quietly
        // reopen the door.
        advanced_disable_flags: true,
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

  it('sets first-touch ref once on the person when known', async () => {
    storeConsent('all');
    await identifyUser('11111111-1111-4111-8111-111111111111', {
      signup_attribution_ref: 'hn',
    });
    expect(posthogMock.identify).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      undefined,
      { signup_attribution_ref: 'hn' },
    );
  });
});

describe('withdrawAnalyticsConsent() — GDPR Art. 7(3) (D147)', () => {
  it('flips the stored choice to "essential" in both stores and resets the loaded SDK', async () => {
    storeConsent('all');
    await track('page_viewed', { page: 'senders', mailbox_id: null }); // SDK loads

    await withdrawAnalyticsConsent();

    expect(readStoredConsent()).toBe('essential');
    expect(window.localStorage.getItem('dm-cookie-consent')).toBe('essential');
    expect(document.cookie).toContain('dm_cookie_consent=essential');
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
  });

  it('track() no-ops immediately after withdrawal — the per-call gate, no reload needed', async () => {
    storeConsent('all');
    await track('page_viewed', { page: 'senders', mailbox_id: null });
    expect(posthogMock.capture).toHaveBeenCalledTimes(1);

    await withdrawAnalyticsConsent();
    await track('page_viewed', { page: 'triage', mailbox_id: null });

    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
  });

  it('still stores the withdrawal when the SDK never loaded (keyless) — no reset to call', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    storeConsent('all');

    await withdrawAnalyticsConsent();

    expect(readStoredConsent()).toBe('essential');
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it('works with no prior choice at all — stores an explicit decline', async () => {
    await withdrawAnalyticsConsent();
    expect(readStoredConsent()).toBe('essential');
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it('revokes synchronously even while an existing SDK load is still pending', async () => {
    let resolveSdk!: (sdk: null) => void;
    __setSdkPromiseForTests(
      new Promise<null>((resolve) => {
        resolveSdk = resolve;
      }),
    );
    storeConsent('all');

    const withdrawal = withdrawAnalyticsConsent();
    expect(hasAnalyticsConsent()).toBe(false);
    expect(readStoredConsent()).toBe('essential');

    resolveSdk(null);
    await withdrawal;
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it('keeps consent revoked when the existing SDK load rejects', async () => {
    __setSdkPromiseForTests(Promise.reject(new Error('chunk failed')));
    storeConsent('all');

    await expect(withdrawAnalyticsConsent()).resolves.toBeUndefined();
    expect(hasAnalyticsConsent()).toBe(false);
    expect(readStoredConsent()).toBe('essential');
  });
});

/**
 * Regression cover for the hole that SDK-side `$pageview` / `$pageleave`
 * capture opened. Before them, every capture went through `track()`, which
 * re-reads consent per call — so clearing the stored choice was enough. The
 * autocapture extensions call `capture()` directly off a pushState and never
 * consult `track()`, so withdrawal has to stop the library itself or
 * navigation keeps reporting after opt-out.
 */
describe('withdrawal stops the SDK, not just the stored choice (GDPR Art. 7(3))', () => {
  async function loadSdkViaTrack(): Promise<void> {
    storeConsent('all');
    await track('page_viewed', { page: 'senders', mailbox_id: null });
  }

  it('opts the library out — autocaptured $pageview has no per-call gate', async () => {
    await loadSdkViaTrack();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);

    await withdrawAnalyticsConsent();

    expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1);
  });

  it("opts out AFTER reset — reset() clears posthog's own opt-out flag", async () => {
    await loadSdkViaTrack();

    await withdrawAnalyticsConsent();

    // Reversing these two silently re-enables capture, which is why the
    // order is asserted rather than left to reading order.
    const [resetAt] = posthogMock.reset.mock.invocationCallOrder;
    const [optOutAt] = posthogMock.opt_out_capturing.mock.invocationCallOrder;
    if (resetAt === undefined || optOutAt === undefined) {
      throw new Error('expected both reset() and opt_out_capturing() to have been called');
    }
    expect(resetAt).toBeLessThan(optOutAt);
  });

  it('still opts out when reset() throws — the stop must not depend on cleanup', async () => {
    await loadSdkViaTrack();
    // `reset()` has to run first (it clears posthog's own opt-out flag), so
    // sharing a catch with the opt-out made identity cleanup a single point
    // of failure for the thing that actually stops capture.
    posthogMock.reset.mockImplementationOnce(() => {
      throw new Error('persistence unavailable');
    });

    await expect(withdrawAnalyticsConsent()).resolves.toBeUndefined();

    expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1);
  });

  it('opts out when consent is withdrawn DURING the SDK load, and captures nothing', async () => {
    // The race: `loadSdk` checks consent before `await import(...)`, but
    // `init()` — which starts the autocapture extensions — runs after it. A
    // withdrawal inside that window finds `sdkPromise` still unset and returns
    // having stopped nothing. Withdrawing from inside `init` reproduces it.
    posthogMock.init.mockImplementationOnce(() => {
      storeConsent('essential');
    });
    storeConsent('all');

    await track('page_viewed', { page: 'senders', mailbox_id: null });

    expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('re-granting consent re-opts-in — a persisted opt-out would kill capture forever', async () => {
    await loadSdkViaTrack();
    await withdrawAnalyticsConsent();

    // posthog-js persists the opt-out, so a live SDK still reports it.
    posthogMock.has_opted_out_capturing.mockReturnValue(true);
    posthogMock.capture.mockClear();
    storeConsent('all');

    await track('page_viewed', { page: 'triage', mailbox_id: null });

    expect(posthogMock.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(posthogMock.capture).toHaveBeenCalledWith(
      'page_viewed',
      expect.objectContaining({ page: 'triage' }),
    );
  });
});
