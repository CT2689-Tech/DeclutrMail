import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { pathnameRef } = vi.hoisted(() => ({ pathnameRef: { current: '/' } }));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { PublicMobileMenu } from './public-mobile-menu';

const links = [{ href: '/how-it-works', label: 'How it works' }] as const;

describe('PublicMobileMenu', () => {
  it('closes on Escape and restores focus to the summary', () => {
    const { container } = render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    const details = container.querySelector('details')!;
    const summary = screen.getByText('Menu');
    details.open = true;

    fireEvent.keyDown(details, { key: 'Escape' });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('does not stay open after a client-side route change', () => {
    const { container, rerender } = render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    const details = container.querySelector('details')!;
    details.open = true;

    pathnameRef.current = '/how-it-works';
    rerender(<PublicMobileMenu links={links} startUrl="/oauth" />);

    expect(details.open).toBe(false);
  });

  it('closes immediately when a link targets the current route', () => {
    pathnameRef.current = '/how-it-works';
    const { container } = render(<PublicMobileMenu links={links} startUrl="/oauth" />);
    const details = container.querySelector('details')!;
    details.open = true;

    fireEvent.click(screen.getByRole('link', { name: 'How it works' }));

    expect(details.open).toBe(false);
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
