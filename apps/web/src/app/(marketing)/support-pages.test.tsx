/**
 * Tests for the support pages (D219, D137): /help, /contact, /security.
 *
 * Mirrors legal-pages.test.tsx. Contracts locked here:
 *
 *   1. D134 — public pages render with NO auth round-trip: a clean
 *      render with zero fetch calls proves the AuthProvider chain
 *      isn't imported.
 *   2. D228 — /help and /security carry the locked trust copy from
 *      `@declutrmail/shared` verbatim ("Full bodies fetched: 0" plus
 *      the storage allowlist). The banned pre-D228 phrase
 *      "Bodies read: 0" must not appear.
 *   3. Refund terms are an open founder decision — /help must LINK
 *      /refunds and never state a refund window or guarantee number.
 *   4. /security claims match the repo: single gmail.modify scope,
 *      envelope-encrypted tokens, CASA Tier 2, no ML category
 *      prediction (D222), vulnerability reporting via privacy@.
 *   5. D159 (D132 batch) — each page emits page_viewed exactly once
 *      via the PageViewTracker island; posthog is mocked so the
 *      no-fetch proof stays intact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';

import HelpPage from './help/page';
import ContactPage from './contact/page';
import SecurityPage from './security/page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

const PAGES = [
  { name: '/help', Page: HelpPage, heading: 'Help & FAQ', page: 'help' },
  { name: '/contact', Page: ContactPage, heading: 'Contact', page: 'contact' },
  { name: '/security', Page: SecurityPage, heading: 'Security', page: 'security' },
] as const;

beforeEach(() => {
  trackSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(PAGES)('$name — D219 support surface', ({ Page, heading, page }) => {
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

  it('stamps a last-updated date', () => {
    render(<Page />);
    expect(screen.getByText(/Last updated: \d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
  });

  it('never uses the banned pre-D228 phrase "Bodies read: 0"', () => {
    const { container } = render(<Page />);
    expect(container.textContent).not.toMatch(/bod(y|ies) read: 0/i);
  });
});

describe('/help content — D219 + D137', () => {
  it('quotes the locked trust headline and the full storage allowlist verbatim', () => {
    const { container } = render(<HelpPage />);
    expect(container.textContent).toContain(PRIVACY_BADGE_HEADLINE);
    for (const item of PRIVACY_STORAGE_ITEMS) {
      expect(container.textContent).toContain(item);
    }
  });

  it('links /refunds without stating refund terms (open founder decision)', () => {
    const { container } = render(<HelpPage />);
    expect(container.querySelector('a[href="/refunds"]')).toBeInTheDocument();
    // No number: neither the drifted 30-day guarantee nor the 14-day window.
    expect(container.textContent).not.toMatch(/\d+[- ]day money[- ]back/i);
    expect(container.textContent).not.toMatch(/money[- ]back guarantee/i);
  });

  it('covers unsubscribe honestly: one-click where available, manual mailto (D230)', () => {
    const { container } = render(<HelpPage />);
    expect(container.textContent).toMatch(/one-click unsubscribe/i);
    expect(container.textContent).toMatch(/you send it yourself/i);
    expect(container.textContent).toMatch(/nothing is auto-sent/i);
  });

  it('deep-links each question with a stable slug (D219)', () => {
    render(<HelpPage />);
    for (const id of ['what-we-store', 'unsubscribe-flow', 'undo-windows', 'autopilot-modes']) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });

  it('links the deeper pages: /pricing, /privacy, /contact', () => {
    const { container } = render(<HelpPage />);
    for (const href of ['/pricing', '/privacy', '/contact']) {
      expect(
        container.querySelector(`a[href="${href}"]`),
        `expected a link to ${href}`,
      ).toBeInTheDocument();
    }
  });

  it('states the undo windows and the 7-day account-deletion grace', () => {
    const { container } = render(<HelpPage />);
    expect(container.textContent).toMatch(/7 days on Free and Plus, 30 days on Pro/);
    expect(container.textContent).toMatch(/7-day grace period/);
  });

  it('emits FAQPage JSON-LD mirroring the rendered questions', () => {
    const { container } = render(<HelpPage />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeInTheDocument();
    const data = JSON.parse(script!.textContent ?? '{}') as {
      '@type': string;
      mainEntity: Array<{ name: string }>;
    };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.length).toBe(10);
    for (const { name } of data.mainEntity) {
      // Each marked-up question appears on the page (Google requires
      // it) — twice, in fact: the TOC row and the section heading.
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });
});

describe('/contact content', () => {
  it('publishes both mailboxes as mailto links and the modest response time', () => {
    const { container } = render(<ContactPage />);
    expect(container.querySelector('a[href="mailto:support@declutrmail.com"]')).toBeInTheDocument();
    expect(container.querySelector('a[href="mailto:privacy@declutrmail.com"]')).toBeInTheDocument();
    expect(container.textContent).toMatch(/2 business days/);
  });

  it('links /help and has no form (mailto-only surface)', () => {
    const { container } = render(<ContactPage />);
    expect(container.querySelector('a[href="/help"]')).toBeInTheDocument();
    expect(container.querySelector('form')).not.toBeInTheDocument();
    expect(container.querySelector('input, textarea')).not.toBeInTheDocument();
  });
});

describe('/security content — verified claims only', () => {
  it('shows the locked trust headline and the full storage allowlist', () => {
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toContain(PRIVACY_BADGE_HEADLINE);
    for (const item of PRIVACY_STORAGE_ITEMS) {
      expect(container.textContent).toContain(item);
    }
  });

  it('names the single Gmail scope and the metadata-only fetch posture', () => {
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toContain('gmail.modify');
    expect(container.textContent).toMatch(/metadata/i);
  });

  it('describes token envelope encryption and TLS accurately', () => {
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toMatch(/envelope-encrypted/i);
    expect(container.textContent).toMatch(/AES-256-GCM/);
    expect(container.textContent).toMatch(/TLS/);
  });

  it('states the CASA Tier 2 verification', () => {
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toMatch(/CASA/);
    expect(container.textContent).toMatch(/Tier 2/);
  });

  it('states the D222 no-ML-category-prediction posture', () => {
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toMatch(/not use machine learning to predict email categories/i);
  });

  it('points vulnerability reports at privacy@declutrmail.com', () => {
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toMatch(/vulnerability/i);
    expect(container.querySelector('a[href="mailto:privacy@declutrmail.com"]')).toBeInTheDocument();
  });
});
