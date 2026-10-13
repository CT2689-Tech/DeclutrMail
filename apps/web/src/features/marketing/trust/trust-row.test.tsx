/**
 * The trust link sits inside comparison prose (`.dm-story`) and the FAQ
 * reading column (`.dm-read-body`). Those rules style every bare or body
 * link. The row's own class is what keeps it a muted, ununderlined line.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import { TrustRow } from './trust-row';
import { FaqPage } from '../learn/index-pages';
import { AlternativesScreen } from '../comparison/alternatives-screen';
import { ALTERNATIVES_SLUGS, COMPARISONS, alternativesFor } from '../comparison/comparison-data';
import { ComparisonDetailScreen } from '../comparison/comparison-screen';

function expectTrustLink(container: HTMLElement) {
  const link = container.querySelector('a.dm-trust-link');
  expect(link).not.toBeNull();
  expect(link).toHaveAttribute('href', '/security#verification');
  expect(link).toHaveClass('dm-trust-link');
}

describe('trust link name', () => {
  it('names the link with the visible sentence', () => {
    const { getByRole } = render(<TrustRow />);
    const link = getByRole('link');
    expect(link).not.toHaveAttribute('aria-label');
    expect(link).toHaveAccessibleName(/Google OAuth verification approved/);
  });
});

describe('trust link class on prose templates', () => {
  beforeEach(() => track.mockClear());

  it.each(COMPARISONS.map((comparison) => [comparison.slug, comparison] as const))(
    '/vs/%s gives the trust link its own class',
    (_slug, comparison) => {
      const { container } = render(<ComparisonDetailScreen comparison={comparison} />);
      expect(container.querySelector('.dm-story a.dm-trust-link')).not.toBeNull();
      expectTrustLink(container);
    },
  );

  it.each(ALTERNATIVES_SLUGS.map((slug) => [slug] as const))(
    '/alternatives/%s gives the trust link its own class',
    (slug) => {
      const page = alternativesFor(slug);
      expect(page).toBeTruthy();
      const { container } = render(<AlternativesScreen page={page!} />);
      expect(container.querySelector('.dm-story a.dm-trust-link')).not.toBeNull();
      expectTrustLink(container);
    },
  );

  it('/faq gives the trust link its own class inside the reading column', () => {
    const { container } = render(<FaqPage />);
    expect(container.querySelector('.dm-read-body a.dm-trust-link')).not.toBeNull();
    expectTrustLink(container);
  });
});
