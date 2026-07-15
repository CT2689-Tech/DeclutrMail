import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: '/' as string | null },
}));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { PublicNavLinks, isPublicNavLinkActive } from './public-nav-links';

const links = [
  { href: '/inbox-simulator', label: 'Demo' },
  { href: '/compare', label: 'Compare' },
  { href: '/pricing', label: 'Pricing' },
] as const;

describe('PublicNavLinks', () => {
  it.each([
    ['/inbox-simulator', '/inbox-simulator'],
    ['/demo', '/inbox-simulator'],
    ['/compare', '/compare'],
    ['/vs/clean-email', '/compare'],
    ['/pricing', '/pricing'],
  ])('maps %s to the stable %s navigation tab', (pathname, href) => {
    expect(isPublicNavLinkActive(pathname, href)).toBe(true);
  });

  it('marks only the current navigation destination', () => {
    pathnameRef.current = '/vs/sanebox';
    render(<PublicNavLinks links={links} />);

    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Demo' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute('aria-current');
  });

  it('renders without an active destination while the pathname is unavailable', () => {
    pathnameRef.current = null;
    render(<PublicNavLinks links={links} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Compare' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Demo' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute('aria-current');
  });
});
