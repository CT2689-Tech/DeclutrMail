import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pathnameRef } = vi.hoisted(() => ({ pathnameRef: { current: '/' } }));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { WS3_COPY } from '@declutrmail/shared/copy/launch';

import { PublicMobileMenu } from './public-mobile-menu';

const links = [{ href: '/how-it-works', label: 'How it works' }] as const;
const [openLabel, closeLabel] = WS3_COPY['ws3.nav.menu.aria'];
const menuProps = { links, startUrl: '/oauth', openLabel, closeLabel };

beforeEach(() => {
  pathnameRef.current = '/';
});

describe('PublicMobileMenu', () => {
  it('starts Google OAuth directly from both auth actions', () => {
    render(<PublicMobileMenu {...menuProps} />);
    fireEvent.click(screen.getByRole('button', { name: openLabel }));

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?returning=1',
    );
    const starts = screen.getAllByRole('link', { name: 'Start free' });
    expect(starts).toHaveLength(2);
    for (const link of starts) expect(link).toHaveAttribute('href', '/oauth');
  });

  it('closes on Escape and restores focus to the menu button', () => {
    render(<PublicMobileMenu {...menuProps} />);
    fireEvent.click(screen.getByRole('button', { name: openLabel }));
    const button = screen.getByRole('button', { name: closeLabel });
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.getByRole('button', { name: openLabel })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.activeElement).toBe(button);
  });

  it('does not stay open after a client-side route change', () => {
    const { rerender } = render(<PublicMobileMenu {...menuProps} />);
    fireEvent.click(screen.getByRole('button', { name: openLabel }));

    pathnameRef.current = '/how-it-works';
    rerender(<PublicMobileMenu {...menuProps} />);

    expect(screen.getByRole('button', { name: openLabel })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps Tab inside the open menu', () => {
    render(<PublicMobileMenu {...menuProps} />);
    fireEvent.click(screen.getByRole('button', { name: openLabel }));
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const last = [...nav.querySelectorAll('a')].at(-1);
    expect(last).toBeTruthy();
    last!.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: closeLabel }));

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes immediately when a link targets the current route', () => {
    pathnameRef.current = '/how-it-works';
    render(<PublicMobileMenu {...menuProps} />);
    fireEvent.click(screen.getByRole('button', { name: openLabel }));
    const link = screen.getByRole('link', { name: 'How it works' });
    expect(link).toHaveAttribute('aria-current', 'page');
    fireEvent.click(link);
    expect(screen.getByRole('button', { name: openLabel })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
