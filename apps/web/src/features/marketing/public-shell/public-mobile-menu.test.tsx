import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pathnameRef } = vi.hoisted(() => ({ pathnameRef: { current: '/' } }));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { PublicMobileMenu } from './public-mobile-menu';

const links = [{ href: '/how-it-works', label: 'How it works' }] as const;

beforeEach(() => {
  pathnameRef.current = '/';
});

describe('PublicMobileMenu', () => {
  it('starts Google OAuth directly from both auth actions', () => {
    render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/oauth');
    expect(screen.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/oauth');
  });

  it('closes on Escape and restores focus to the menu button', () => {
    render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const button = screen.getByRole('button', { name: 'Close navigation' });
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.activeElement).toBe(button);
  });

  it('does not stay open after a client-side route change', () => {
    const { rerender } = render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    pathnameRef.current = '/how-it-works';
    rerender(<PublicMobileMenu links={links} startUrl="/oauth" />);

    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('closes immediately when a link targets the current route', () => {
    pathnameRef.current = '/how-it-works';
    render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const link = screen.getByRole('link', { name: 'How it works' });
    expect(link).toHaveAttribute('aria-current', 'page');
    fireEvent.click(link);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
