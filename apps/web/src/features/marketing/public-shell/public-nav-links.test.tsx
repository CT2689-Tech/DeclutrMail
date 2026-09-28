import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: '/' as string | null },
}));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { PublicNavLinks, isPublicNavLinkActive } from './public-nav-links';

const links = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/inbox-simulator', label: 'Demo' },
] as const;

describe('PublicNavLinks', () => {
  it.each([
    ['/inbox-simulator', '/inbox-simulator'],
    ['/demo', '/inbox-simulator'],
    ['/how-it-works', '/how-it-works'],
    ['/pricing', '/pricing'],
  ])('maps %s to the stable %s navigation tab', (pathname, href) => {
    expect(isPublicNavLinkActive(pathname, href)).toBe(true);
  });

  it('marks only the current navigation destination', () => {
    pathnameRef.current = '/demo';
    render(<PublicNavLinks links={links} />);

    expect(screen.getByRole('link', { name: 'Demo' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'How it works' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute('aria-current');
  });

  it('renders without an active destination while the pathname is unavailable', () => {
    pathnameRef.current = null;
    render(<PublicNavLinks links={links} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'How it works' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Demo' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute('aria-current');
  });
});
