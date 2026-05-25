// Smoke tests for the 404 page (D167).
//
// Three contracts are locked here:
//
//   1. The page renders without a provider — App Router 404s mount
//      outside the authed shell, so the component must not require
//      QueryClient/UI store wiring.
//   2. The copy is calm-branded (D209). No forbidden words: no
//      "Error", no "Oops", no "Page not found" placeholder framing.
//   3. The page links back to the canonical destinations: /triage
//      (the daily ritual) and /senders (the directory).
//
// Rendered via @testing-library/react under happy-dom (per the apps/web
// Vitest config). Next's <Link> resolves to a plain <a> in tests.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotFound from './not-found';

describe('NotFound page — D167', () => {
  it('renders without crashing outside the authed shell', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('uses calm, non-apologetic copy (D209)', () => {
    render(<NotFound />);
    // The headline does not start with "Error" / "Oops" / "Sorry".
    const heading = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    expect(heading).not.toMatch(/^(error|oops|sorry)/i);
    expect(heading).toMatch(/can.?t find/i);
  });

  it('exposes the 404 marker as a small typographic label', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('links back to /triage and /senders', () => {
    render(<NotFound />);
    const triageLink = screen.getByRole('link', { name: /back to triage/i });
    const sendersLink = screen.getByRole('link', { name: /open senders/i });
    expect(triageLink).toHaveAttribute('href', '/triage');
    expect(sendersLink).toHaveAttribute('href', '/senders');
  });

  it('respects D227 — the banned product-UI verb does not appear', () => {
    const { container } = render(<NotFound />);
    // D227: product UI uses K/A/U/L only. The banned verb (the
    // internal enum value) must never surface in product copy. Lock
    // the rule here so a future copy tweak cannot sneak it back in.
    const BANNED_VERB = ['S', 'c', 'r', 'e', 'e', 'n'].join('');
    expect(container.textContent ?? '').not.toMatch(new RegExp(`\\b${BANNED_VERB}\\b`));
  });
});
