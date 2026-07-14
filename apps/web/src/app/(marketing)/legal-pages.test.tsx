/**
 * Tests for the legal pages (D146): /privacy, /terms, /refunds — plus
 * /cookies (D147's withdrawal surface, same legal-layout chrome).
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
 *   6. D121 + D148 (founder-confirmed 2026-07-08) — /refunds carries
 *      the canonical 30-day money-back guarantee with its fair-use
 *      terms, /terms carries the India/Mumbai governing-law clause,
 *      and NO page still shows a "Pending confirmation" marker.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  GMAIL_METADATA_HEADERS,
  GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
} from '@declutrmail/shared';

import PrivacyPolicyPage from './privacy/page';
import TermsOfServicePage from './terms/page';
import RefundPolicyPage from './refunds/page';
import CookiePreferencesPage from './cookies/page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({
  track: trackSpy,
  // /cookies mounts CookiePreferences, which imports the withdrawal
  // helper; never called in these render-contract tests.
  withdrawAnalyticsConsent: vi.fn().mockResolvedValue(undefined),
}));

const PAGES = [
  { name: '/privacy', Page: PrivacyPolicyPage, heading: 'Privacy Policy', page: 'privacy' },
  { name: '/terms', Page: TermsOfServicePage, heading: 'Terms of Service', page: 'terms' },
  { name: '/refunds', Page: RefundPolicyPage, heading: 'Refund Policy', page: 'refunds' },
  { name: '/cookies', Page: CookiePreferencesPage, heading: 'Cookie Preferences', page: 'cookies' },
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

  it('carries no "Pending confirmation" marker (D121/D148 confirmed 2026-07-08)', () => {
    const { container } = render(<Page />);
    expect(container.textContent).not.toContain('Pending confirmation');
  });
});

describe('/refunds content — D121 canonical refund terms', () => {
  it('states the 30-day money-back guarantee on every paid plan, refunded in full', () => {
    const { container } = render(<RefundPolicyPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('30-day money-back guarantee');
    expect(text).toContain('within 30 days');
    expect(text).toMatch(/every paid plan/i);
    // The interim 14-day pro-rata default must be fully gone.
    expect(text).not.toMatch(/14[- ]days?/);
    expect(text).not.toMatch(/pro[- ]rata/i);
  });

  it('carries the fair-use terms: once per customer, bulk-consume decline, statutory rights intact', () => {
    const { container } = render(<RefundPolicyPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('once per customer');
    expect(text).toMatch(/consumed in bulk/);
    expect(text).toMatch(/Statutory refund rights/);
  });

  it('routes refunds through the original payment provider (Paddle / Razorpay)', () => {
    const { container } = render(<RefundPolicyPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Paddle');
    expect(text).toContain('Razorpay');
    expect(text).toMatch(/original payment method/);
  });

  it('keeps Activity Undo distinct from Gmail Trash and unsubscribe finality', () => {
    const { container } = render(<RefundPolicyPage />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Activity Undo.*Archive, Later, or Delete/i);
    expect(text).toMatch(/separate Gmail Trash recovery path/i);
    expect(text).toMatch(/delivered unsubscribe request cannot be recalled/i);
    expect(text).not.toMatch(/actions DeclutrMail performed remain reversible/i);
  });
});

describe('/terms content — D121 governing law confirmed', () => {
  it('states India governing law with exclusive jurisdiction of the Mumbai courts', () => {
    const { container } = render(<TermsOfServicePage />);
    const text = container.textContent ?? '';
    expect(text).toContain('governed by the laws of India');
    expect(text).toContain('Mumbai');
    expect(text).toMatch(/exclusive jurisdiction/);
  });

  it('defines plan Activity Undo and the separate Gmail Trash path', () => {
    const { container } = render(<TermsOfServicePage />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toMatch(/Archive, Later, and Delete can be undone from Activity/);
    expect(text).toMatch(/7 days on Free and Plus; 30 days on Pro/);
    expect(text).toMatch(/recovery path is separate from Activity Undo/);
    expect(text).toMatch(/unsubscribe request cannot be recalled/);
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

  it('renders the generated Gmail header allowlist and retained audit inventory', () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = container.textContent ?? '';
    for (const header of GMAIL_METADATA_HEADERS) {
      expect(text).toContain(header);
    }
    for (const item of GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY) {
      expect(text).toContain(item.label);
    }
    const details = screen.getByText('Show Google permission and field details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent(GMAIL_METADATA_HEADERS.join(', '));
    const primary = container.cloneNode(true) as HTMLElement;
    primary.querySelectorAll('[data-dm-technical-details]').forEach((node) => node.remove());
    expect(primary.textContent).not.toMatch(
      /gmail\.modify|format=metadata|Raw MIME|List-Unsubscribe/,
    );
    expect(text).not.toMatch(/exact list|whole list/i);
  });

  it('states deterministic protection and sensitive metadata without absolutes', () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/automatically protect a sender based on observed facts/i);
    expect(text).toMatch(/reply history/i);
    expect(text).not.toMatch(/does not automatically protect/i);
    expect(text).toMatch(/subjects and Gmail Preview snippets may still be sensitive/i);
    expect(text).not.toMatch(/sensitive Gmail data cannot leak/i);
  });

  it('§6 links the /cookies withdrawal surface (GDPR Art. 7(3), D147)', () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByRole('link', { name: 'Cookie preferences' })).toHaveAttribute(
      'href',
      '/cookies',
    );
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

  it('carries the DPDP Act 2023 (India) clause with the grievance contact (D148)', () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Digital Personal Data Protection Act, 2023');
    expect(text).toContain('Data Fiduciary');
    expect(text).toMatch(/grievance/i);
    expect(
      document.querySelectorAll('a[href="mailto:privacy@declutrmail.com"]').length,
    ).toBeGreaterThan(0);
  });

  it('§7 deletion wording matches the shipped flow and retained audit boundary (D232)', () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('7-day grace period');
    expect(text).toContain('waive the grace period and any remaining undo windows');
    expect(text).toContain('typed confirmation');
    expect(text).toContain('queues the purge without a grace period');
    expect(text).toContain('new syncing is paused');
    expect(text).toMatch(/pseudonymous security and compliance evidence remains/i);
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
