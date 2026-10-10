import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

const { track } = vi.hoisted(() => ({
  track: vi.fn(async (_event: string, _props: { cta: string; placement: string }) => undefined),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/posthog', () => ({ track }));

import { PublicFooter, PublicHeader } from './public-shell';

const PERMISSION_ENTRY = '/sign-in';

describe('PublicHeader auth entry', () => {
  beforeEach(() => {
    track.mockClear();
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Header actions enter the same permission checkpoint on desktop and mobile.
  it('sends every auth action to the permission checkpoint', () => {
    const { container } = render(<PublicHeader />);

    const authLinks = screen.getAllByRole('link', { name: /Sign in|Start free/ });
    expect(authLinks.length).toBeGreaterThan(0);
    for (const link of authLinks) {
      expect(link).toHaveAttribute(
        'href',
        link.textContent === 'Sign in' ? '/sign-in?returning=1' : PERMISSION_ENTRY,
      );
    }

    expect(container.querySelectorAll('a[href*="/api/auth/google/start"]')).toHaveLength(0);
  });

  /**
   * "Sign in" (returning user) and "Start free" (new user) must stay
   * separable in the D159 acquisition funnel. Both emit `connect_gmail`
   * because both start the same OAuth flow, so `placement` is the only
   * discriminator — a shared value would silently merge the two series.
   */
  it('offers a direct workspace link when a session hint is present', () => {
    document.cookie = 'dm_csrf=synthetic-hint; path=/';
    try {
      render(<PublicHeader />);
      expect(screen.getByRole('link', { name: 'Open DeclutrMail' })).toHaveAttribute(
        'href',
        '/home',
      );
      expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
      const mobile = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
      expect(mobile.getByRole('link', { name: 'Open DeclutrMail' })).toHaveAttribute(
        'href',
        '/home',
      );
    } finally {
      document.cookie = 'dm_csrf=; Max-Age=0; path=/';
    }
  });

  it('keeps the sign-in and start-free CTAs on distinct placements', () => {
    render(<PublicHeader />);

    const actions = document.querySelector('.dm-public-actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('link', { name: 'Sign in' }));
    fireEvent.click(within(actions).getByRole('link', { name: /Start free/ }));

    expect(track.mock.calls.map(([, props]) => props.placement)).toEqual(['nav_sign_in', 'nav']);
    for (const [event, props] of track.mock.calls) {
      expect(event).toBe('landing_cta_clicked');
      expect(props).toMatchObject({ cta: 'connect_gmail' });
    }
  });

  it('exposes comparison, privacy, and theme choice in the public header', () => {
    const { container } = render(<PublicHeader />);
    const desktop = within(container.querySelector('.dm-public-nav') as HTMLElement);
    for (const label of ['How it works', 'Pricing', 'Demo', 'Compare', 'Privacy & control']) {
      expect(desktop.getByRole('link', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const mobile = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    for (const label of ['How it works', 'Pricing', 'Demo', 'Compare', 'Privacy & control']) {
      expect(mobile.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeInTheDocument();
  });

  it('hydrates the public theme control without a server/client mismatch', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<PublicHeader />);
    const recoverable: Error[] = [];
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <PublicHeader />, {
        onRecoverableError: (error) => recoverable.push(error as Error),
      });
    });
    expect(recoverable).toEqual([]);
    await act(async () => root?.unmount());
  });
});

describe('PublicFooter directory', () => {
  it('links Compare and Guides from the data modules, and keeps Privacy', () => {
    render(<PublicFooter />);
    const footer = within(screen.getByRole('contentinfo'));

    expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(footer.getByRole('link', { name: 'All comparisons' })).toHaveAttribute(
      'href',
      '/compare',
    );
    expect(footer.getByRole('link', { name: 'DeclutrMail vs SaneBox' })).toHaveAttribute(
      'href',
      '/vs/sanebox',
    );
    expect(footer.getByRole('link', { name: 'SaneBox alternatives' })).toHaveAttribute(
      'href',
      '/alternatives/sanebox',
    );
    expect(
      footer.getByRole('link', { name: 'How to auto archive emails in Gmail' }),
    ).toHaveAttribute('href', '/how-to/auto-archive-future-emails-in-gmail');

    expect(
      within(footer.getByRole('navigation', { name: 'Compare' })).getAllByRole('link'),
    ).toHaveLength(14);
    expect(
      within(footer.getByRole('navigation', { name: 'Guides' })).getAllByRole('link'),
    ).toHaveLength(7);
    expect(
      within(footer.getByRole('navigation', { name: 'Learn' })).queryByRole('link', {
        name: 'Compare',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(footer.getByRole('navigation', { name: 'Learn' })).queryByRole('link', {
        name: 'Guides',
      }),
    ).not.toBeInTheDocument();
  });
});
