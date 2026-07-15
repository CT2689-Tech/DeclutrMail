/**
 * /beta — beta status page (buildout F7; open-beta copy 2026-07-07).
 *
 * Two render variants share one page:
 *   - organic visit (no `reason` param) → open-beta copy with a real
 *     "Sign in with Google" CTA (signup is open: BETA_GATE_ENABLED is
 *     off in prod), NO `beta_gate_denied` event, NO waitlist CTA
 *   - OAuth-callback denial (`?reason=not_invited`) → denial copy +
 *     exactly one `beta_gate_denied` emit with the closed-enum payload
 *     (never the denied email — D7/D159)
 *
 * The page is a public marketing route: like the layout test above it,
 * a clean render with no fetch proves no auth chain is mounted.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeConsent } from '@/lib/cookie-consent';

import BetaPage from './page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

beforeEach(() => {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
  storeConsent('all');
  trackSpy.mockClear();
});

afterEach(() => {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
  trackSpy.mockClear();
  vi.restoreAllMocks();
});

async function renderPage(params: Record<string, string> = {}) {
  return render(await BetaPage({ searchParams: Promise.resolve(params) }));
}

/** All track() calls for one event name (the page now emits two kinds). */
function callsFor(event: string) {
  return trackSpy.mock.calls.filter(([name]) => name === event);
}

describe('/beta page — F7 beta status page', () => {
  it('renders the open-beta copy with sign-in + founder-contact CTAs and no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await renderPage();

    expect(
      screen.getByRole('heading', { name: /declutrmail is in open beta/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in with google/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/api\/auth\/google\/start$/),
    );
    expect(screen.getByRole('link', { name: /email the founder/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
    // The Team-tier waitlist CTA is gone — signup is open (2026-07-07).
    expect(screen.queryByRole('link', { name: /waitlist/i })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders the denial copy with a founder-contact CTA when redirected by the gate', async () => {
    await renderPage({ reason: 'not_invited' });

    expect(
      screen.getByRole('heading', { name: /this email needs an invite right now/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /email the founder/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
  });

  it('does NOT emit beta_gate_denied on an organic visit', async () => {
    await renderPage();
    expect(callsFor('beta_gate_denied')).toHaveLength(0);
  });

  it('emits beta_gate_denied exactly once when redirected with ?reason=not_invited', async () => {
    await renderPage({ reason: 'not_invited' });

    expect(callsFor('beta_gate_denied')).toHaveLength(1);
    expect(trackSpy).toHaveBeenCalledWith('beta_gate_denied', { source: 'oauth_callback' });
  });

  it('treats an unknown reason value as an organic visit (no emit)', async () => {
    await renderPage({ reason: 'something-else' });
    expect(callsFor('beta_gate_denied')).toHaveLength(0);
  });

  it('emits page_viewed exactly once on every variant (D159, D132 batch)', async () => {
    await renderPage();
    expect(callsFor('page_viewed')).toEqual([['page_viewed', { page: 'beta', mailbox_id: null }]]);

    trackSpy.mockClear();
    await renderPage({ reason: 'not_invited' });
    expect(callsFor('page_viewed')).toEqual([['page_viewed', { page: 'beta', mailbox_id: null }]]);
  });
});
