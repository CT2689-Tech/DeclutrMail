/**
 * /beta — private-beta waitlist page (buildout F7).
 *
 * Two render variants share one page:
 *   - organic visit (no `reason` param) → generic invite-only copy,
 *     NO `beta_gate_denied` event
 *   - OAuth-callback denial (`?reason=not_invited`) → denial copy +
 *     exactly one `beta_gate_denied` emit with the closed-enum payload
 *     (never the denied email — D7/D159)
 *
 * The page is a public marketing route: like the layout test above it,
 * a clean render with no fetch proves no auth chain is mounted.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BetaPage from './page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

afterEach(() => {
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

describe('/beta page — F7 private-beta waitlist', () => {
  it('renders the invite-only copy with waitlist + founder-contact CTAs and no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await renderPage();

    expect(
      screen.getByRole('heading', { name: /declutrmail is invite-only right now/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /join the waitlist/i })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(screen.getByRole('link', { name: /email the founder/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
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
