/**
 * Tests for P1 marketing pages: /methodology (D139) and /changelog (D218).
 *
 * Mirrors support-pages.test.tsx. Contracts locked here:
 *
 *   1. D134 — public pages render with NO auth round-trip.
 *   2. D228 — /methodology quotes locked privacy copy verbatim;
 *      banned "Bodies read: 0" must not appear on either page.
 *   3. D222 — /methodology states no ML category prediction.
 *   4. D227 / D226 / D230 — canonical verbs, preview→mutation→undo,
 *      mailto unsubscribe is manual.
 *   5. D159 — each page emits page_viewed exactly once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
} from '@declutrmail/shared';

import MethodologyPage from './methodology/page';
import ChangelogPage from './changelog/page';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

const PAGES = [
  { name: '/methodology', Page: MethodologyPage, heading: 'Methodology', page: 'methodology' },
  { name: '/changelog', Page: ChangelogPage, heading: 'Changelog', page: 'changelog' },
] as const;

beforeEach(() => {
  trackSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(PAGES)('$name — P1 marketing surface', ({ Page, heading, page }) => {
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

describe('/methodology content — D139 pragmatic slice', () => {
  it('quotes the locked trust headline, storage allowlist, and never-store list verbatim', () => {
    const { container } = render(<MethodologyPage />);
    expect(container.textContent).toContain(PRIVACY_BADGE_HEADLINE);
    for (const item of PRIVACY_STORAGE_ITEMS) {
      expect(container.textContent).toContain(item);
    }
    for (const item of PRIVACY_NEVER_ITEMS) {
      expect(container.textContent).toContain(item);
    }
  });

  it('covers the eight D139 sections', () => {
    render(<MethodologyPage />);
    for (const id of [
      'promise',
      'what-we-see',
      'what-we-never-store',
      'how-we-recommend',
      'how-we-act',
      'privacy-security',
      'open-questions',
      'founders-note',
    ]) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });

  it('states undo windows and bans category ML prediction (D222)', () => {
    const { container } = render(<MethodologyPage />);
    expect(container.textContent).toMatch(/7 days on Free and Plus, 30 days on Pro/);
    expect(container.textContent).toMatch(/not.*machine learning to predict email categories/i);
  });

  it('names the canonical verbs and the preview → mutation → undo lifecycle', () => {
    const { container } = render(<MethodologyPage />);
    expect(container.textContent).toMatch(/Keep, Archive, Unsubscribe, Later, or Delete/);
    expect(container.textContent).toMatch(/action preview/i);
    expect(container.textContent).toMatch(/you send it yourself/i);
  });

  it('links /help, /security, /privacy, and /pricing', () => {
    const { container } = render(<MethodologyPage />);
    for (const href of ['/help', '/security', '/privacy', '/pricing']) {
      expect(
        container.querySelector(`a[href="${href}"]`),
        `expected a link to ${href}`,
      ).toBeInTheDocument();
    }
  });
});

describe('/changelog content — D218 thin shell', () => {
  it('lists reverse-chronological milestones without invented semver', () => {
    const { container } = render(<ChangelogPage />);
    expect(container.textContent).toMatch(/Open beta/);
    expect(container.textContent).toMatch(/Sender-level cleanup/);
    expect(container.textContent).toMatch(/Full bodies fetched: 0/);
    expect(container.textContent).not.toMatch(/v\d+\.\d+\.\d+/);
  });

  it('links /help and /beta', () => {
    const { container } = render(<ChangelogPage />);
    expect(container.querySelector('a[href="/help"]')).toBeInTheDocument();
    expect(container.querySelector('a[href="/beta"]')).toBeInTheDocument();
  });
});
