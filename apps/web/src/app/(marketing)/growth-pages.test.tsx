/**
 * Growth IA smoke tests (D132 Tiers 2–5 + D133/D142–D145).
 *
 * Public pages must render with zero fetch, emit page_viewed, and keep
 * privacy/refund honesty. Nested /vs /how-to /answers share data modules
 * so hub + leaf pages cannot drift.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PRIVACY_BADGE_HEADLINE } from '@declutrmail/shared';

import ComparePage from './compare/page';
import BlogPage from './blog/page';
import VsCleanEmailPage from './vs/clean-email/page';
import HowToPage from './how-to/clean-gmail-by-sender/page';
import AnswerPage from './answers/is-it-safe-to-connect-gmail-app/page';
import { COMPETITORS } from '@/features/marketing/growth/vs-data';
import { HOW_TO_PAGES } from '@/features/marketing/growth/how-to-data';
import { ANSWER_PAGES } from '@/features/marketing/growth/answers-data';

const { trackSpy } = vi.hoisted(() => ({
  trackSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/posthog', () => ({ track: trackSpy }));

beforeEach(() => {
  trackSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('growth data completeness — D132', () => {
  it('ships 5 competitor pages with D144 callouts', () => {
    expect(COMPETITORS).toHaveLength(5);
    for (const c of COMPETITORS) {
      expect(c.chooseThemIf.length).toBeGreaterThan(20);
      expect(c.rows).toHaveLength(10);
      expect(c.path).toBe(`/vs/${c.slug}`);
    }
  });

  it('ships 5 how-to pages with steps', () => {
    expect(HOW_TO_PAGES).toHaveLength(5);
    for (const p of HOW_TO_PAGES) {
      expect(p.steps.length).toBeGreaterThanOrEqual(3);
      expect(p.answer.split(/\s+/).length).toBeGreaterThan(20);
    }
  });

  it('ships 5 answer pages with question H1s', () => {
    expect(ANSWER_PAGES).toHaveLength(5);
    for (const p of ANSWER_PAGES) {
      expect(p.question.endsWith('?') || p.question.includes('?')).toBe(true);
    }
  });
});

describe('/compare — D145', () => {
  it('renders without fetch and lists every /vs path', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<ComparePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Compare' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const c of COMPETITORS) {
      expect(container.querySelector(`a[href="${c.path}"]`)).toBeInTheDocument();
    }
  });

  it('emits page_viewed=compare', () => {
    render(<ComparePage />);
    expect(trackSpy).toHaveBeenCalledWith('page_viewed', {
      page: 'compare',
      mailbox_id: null,
    });
  });
});

describe('/vs/clean-email — D142–D144', () => {
  it('shows the honest choose-them callout and trust headline', () => {
    const { container } = render(<VsCleanEmailPage />);
    expect(container.textContent).toContain('Choose Clean Email if');
    expect(container.textContent).toContain(PRIVACY_BADGE_HEADLINE);
    expect(container.textContent).not.toMatch(/bod(y|ies) read: 0/i);
  });
});

describe('/how-to + /answers', () => {
  it('how-to emits HowTo JSON-LD', () => {
    const { container } = render(<HowToPage />);
    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.textContent ?? '{}') as { '@type': string };
    expect(data['@type']).toBe('HowTo');
  });

  it('answers quotes the locked privacy headline', () => {
    const { container } = render(<AnswerPage />);
    expect(container.textContent).toContain(PRIVACY_BADGE_HEADLINE);
    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.textContent ?? '{}') as { '@type': string };
    expect(data['@type']).toBe('FAQPage');
  });
});

describe('/blog shell', () => {
  it('renders the empty index with pointers', () => {
    const { container } = render(<BlogPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Blog' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/changelog"]')).toBeInTheDocument();
  });
});
