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
import { NotFoundView, metadata } from './not-found';

// The async default export reads `cookies()`; these tests drive the
// synchronous presentational `NotFoundView` with an explicit `authed`
// flag so no request context is needed (App Router 404s mount outside
// the authed shell — the view must not require QueryClient/UI wiring).

describe('NotFound page — D167 / D140', () => {
  it('renders without crashing outside the authed shell', () => {
    render(<NotFoundView authed />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('uses calm, non-apologetic copy (D209)', () => {
    render(<NotFoundView authed />);
    // The headline does not start with "Error" / "Oops" / "Sorry".
    const heading = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    expect(heading).not.toMatch(/^(error|oops|sorry)/i);
    expect(heading).toMatch(/can.?t find/i);
  });

  it('exposes the 404 marker as a small typographic label', () => {
    render(<NotFoundView authed={false} />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('signed-in visitors are routed back into the app (Triage / Senders) — D140', () => {
    render(<NotFoundView authed />);
    expect(screen.getByRole('link', { name: /back to triage/i })).toHaveAttribute(
      'href',
      '/triage',
    );
    expect(screen.getByRole('link', { name: /open senders/i })).toHaveAttribute('href', '/senders');
    // App destinations must NOT leak into the anonymous experience.
    expect(screen.queryByRole('link', { name: /see pricing/i })).not.toBeInTheDocument();
  });

  it('anonymous visitors are routed to marketing (Home / Pricing), never /triage — D140', () => {
    render(<NotFoundView authed={false} />);
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /see pricing/i })).toHaveAttribute('href', '/pricing');
    // /triage would just bounce an anon visitor through a sign-in redirect.
    expect(screen.queryByRole('link', { name: /back to triage/i })).not.toBeInTheDocument();
    // The mailbox-specific reassurance is authed-only copy.
    expect(screen.queryByText(/your mailbox/i)).not.toBeInTheDocument();
  });

  it('carries noindex + a description in page metadata (D132 SEO batch)', () => {
    expect(metadata.title).toBe('Page not found — DeclutrMail');
    expect(metadata.description).toBeTruthy();
    expect(metadata.robots).toEqual({ index: false });
  });

  it('respects D227 — the banned product-UI verb does not appear (both audiences)', () => {
    const authedText = render(<NotFoundView authed />).container.textContent ?? '';
    const anonText = render(<NotFoundView authed={false} />).container.textContent ?? '';
    // D227: product UI uses K/A/U/L/D only. The banned verb (the internal
    // enum value) must never surface in product copy — locked on both branches.
    const banned = new RegExp(`\\b${['S', 'c', 'r', 'e', 'e', 'n'].join('')}\\b`);
    expect(authedText).not.toMatch(banned);
    expect(anonText).not.toMatch(banned);
  });
});
