import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({
  track: vi.fn(async (_event: string, _props: { cta: string; placement: string }) => undefined),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/posthog', () => ({ track }));

import { PublicHeader } from './public-shell';

const OAUTH_START = 'https://api.example.test/api/auth/google/start';

describe('PublicHeader auth entry', () => {
  beforeEach(() => {
    track.mockClear();
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * The header's auth affordances link straight to Google's consent screen
   * rather than routing through `/sign-in`. `/sign-in` still renders — it is
   * the OAuth error surface the API redirects to — so this asserts the header
   * no longer points AT it, not that the route is gone.
   */
  it('sends every auth action to Google OAuth, never to /sign-in', () => {
    const { container } = render(<PublicHeader />);

    const authLinks = screen.getAllByRole('link', { name: /Sign in|Get started/ });
    expect(authLinks.length).toBeGreaterThan(0);
    for (const link of authLinks) {
      expect(link).toHaveAttribute('href', OAUTH_START);
    }

    expect(container.querySelectorAll('a[href="/sign-in"]')).toHaveLength(0);
  });

  /**
   * "Sign in" (returning user) and "Get started" (new user) must stay
   * separable in the D159 acquisition funnel. Both emit `connect_gmail`
   * because both start the same OAuth flow, so `placement` is the only
   * discriminator — a shared value would silently merge the two series.
   */
  it('keeps the sign-in and get-started CTAs on distinct placements', () => {
    render(<PublicHeader />);

    const actions = document.querySelector('.dm-public-actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('link', { name: 'Sign in' }));
    fireEvent.click(within(actions).getByRole('link', { name: /Get started/ }));

    expect(track.mock.calls.map(([, props]) => props.placement)).toEqual(['nav_sign_in', 'nav']);
    for (const [event, props] of track.mock.calls) {
      expect(event).toBe('landing_cta_clicked');
      expect(props).toMatchObject({ cta: 'connect_gmail' });
    }
  });
});
