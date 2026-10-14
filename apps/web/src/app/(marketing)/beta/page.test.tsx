/** Retired organic beta redirects at GA; OAuth denial still renders and tracks. */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeConsent } from '@/lib/cookie-consent';

import BetaPage from './page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
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
  it('redirects organic GA visits to the current workflow', async () => {
    await expect(renderPage()).rejects.toThrow('redirect:/how-it-works');
    expect(trackSpy).not.toHaveBeenCalled();
  });

  it('renders the denial copy with a founder-contact CTA when redirected by the gate', async () => {
    await renderPage({ reason: 'not_invited' });

    expect(
      screen.getByRole('heading', { name: /this email needs an invite right now/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /email us/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
  });

  it('does NOT emit beta_gate_denied on an organic visit', async () => {
    await expect(renderPage()).rejects.toThrow('redirect:/how-it-works');
    expect(callsFor('beta_gate_denied')).toHaveLength(0);
  });

  it('emits beta_gate_denied exactly once when redirected with ?reason=not_invited', async () => {
    await renderPage({ reason: 'not_invited' });

    expect(callsFor('beta_gate_denied')).toHaveLength(1);
    expect(trackSpy).toHaveBeenCalledWith('beta_gate_denied', { source: 'oauth_callback' });
  });

  it('treats an unknown reason value as an organic visit (no emit)', async () => {
    await expect(renderPage({ reason: 'something-else' })).rejects.toThrow(
      'redirect:/how-it-works',
    );
    expect(callsFor('beta_gate_denied')).toHaveLength(0);
  });

  it('emits page_viewed once on the retained denial route', async () => {
    await renderPage({ reason: 'not_invited' });
    expect(callsFor('page_viewed')).toEqual([['page_viewed', { page: 'beta', mailbox_id: null }]]);
  });
});
