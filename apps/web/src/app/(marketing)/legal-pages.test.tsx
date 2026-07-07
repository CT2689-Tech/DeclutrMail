/**
 * Tests for the legal pages (D146): /privacy, /terms, /refunds.
 *
 * Contracts locked here:
 *
 *   1. D134 — public pages render with NO auth round-trip: no
 *      QueryClientProvider in the tree (a clean render proves the
 *      AuthProvider chain isn't imported) and zero fetch calls.
 *   2. D228 — the privacy page carries the locked trust copy from
 *      `@declutrmail/shared` verbatim: the "Full bodies fetched: 0"
 *      headline plus the complete store / never-store lists. The
 *      banned pre-D228 phrase "Bodies read: 0" must not appear.
 *   3. Google Limited Use disclosure links the official policy URL.
 *   4. Footer cross-links — every legal page links to all three
 *      legal routes (the unit's navigation contract).
 *   5. D159 (D132 batch) — each page emits page_viewed exactly once
 *      via the PageViewTracker island; the posthog module is mocked so
 *      the no-fetch proof stays intact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
} from '@declutrmail/shared';

import PrivacyPolicyPage from './privacy/page';
import TermsOfServicePage from './terms/page';
import RefundPolicyPage from './refunds/page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

const PAGES = [
  { name: '/privacy', Page: PrivacyPolicyPage, heading: 'Privacy Policy', page: 'privacy' },
  { name: '/terms', Page: TermsOfServicePage, heading: 'Terms of Service', page: 'terms' },
  { name: '/refunds', Page: RefundPolicyPage, heading: 'Refund Policy', page: 'refunds' },
] as const;

beforeEach(() => {
  trackSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(PAGES)('$name — D146', ({ Page, heading, page }) => {
  it('renders without any fetch and without a QueryClient (D134)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('emits page_viewed exactly once on mount (D159)', () => {
    render(<Page />);
    expect(trackSpy.mock.calls).toEqual([['page_viewed', { page, mailbox_id: null }]]);
  });

  it('cross-links all three legal routes in the chrome', () => {
    render(<Page />);
    for (const href of ['/privacy', '/terms', '/refunds']) {
      const links = document.querySelectorAll(`a[href="${href}"]`);
      expect(links.length, `expected a link to ${href}`).toBeGreaterThan(0);
    }
  });

  it('stamps a last-updated date', () => {
    render(<Page />);
    expect(screen.getByText(/Last updated: \d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
  });
});

describe('/privacy content — D7 + D228 posture', () => {
  it('shows the locked trust headline and the full storage allowlist', () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByText(new RegExp(PRIVACY_BADGE_HEADLINE))).toBeInTheDocument();
    for (const item of PRIVACY_STORAGE_ITEMS) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    for (const item of PRIVACY_NEVER_ITEMS) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it('never uses the banned pre-D228 phrase "Bodies read: 0"', () => {
    const { container } = render(<PrivacyPolicyPage />);
    expect(container.textContent).not.toMatch(/bod(y|ies) read: 0/i);
  });

  it('carries the Google Limited Use disclosure with the official policy link', () => {
    render(<PrivacyPolicyPage />);
    expect(
      document.querySelector(
        'a[href="https://developers.google.com/terms/api-services-user-data-policy"]',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Limited Use requirements/)).toBeInTheDocument();
  });

  it('enumerates all nine subprocessors', () => {
    render(<PrivacyPolicyPage />);
    for (const provider of [
      'Google Cloud',
      'Supabase',
      'Vercel',
      'Upstash',
      'Sentry',
      'PostHog',
      'Resend',
      'Paddle',
      'Razorpay',
    ]) {
      expect(screen.getByRole('cell', { name: provider })).toBeInTheDocument();
    }
  });
});
