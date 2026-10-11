/**
 * Tests for the public `(marketing)` layout (D134 public-route split).
 *
 * The invariant under test: marketing routes render with NO auth
 * round-trip. Two proofs in one render:
 *
 *   1. The layout mounts WITHOUT a QueryClientProvider in the tree.
 *      If anything in its import chain mounted `AuthProvider` (whose
 *      `useMe` calls `useQuery`), the render would throw — so a clean
 *      render is structural evidence the auth chain isn't here.
 *
 *   2. A fetch spy asserts zero network calls — no `GET /api/auth/me`,
 *      no anything. Public pages must not block on the API.
 *
 * The D132 SEO batch adds a third contract: the layout emits the
 * site-wide JSON-LD graph (Organization + WebSite + SoftwareApplication),
 * with offers derived from the D19 tier manifest — the assertions below
 * are computed FROM `TIER_MANIFEST`, so a re-price flows through with no
 * test edit.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildOffersJsonLd } from '@declutrmail/shared/entitlements';

import { siteUrl } from '@/features/marketing/landing/urls';

import MarketingLayout from './layout';

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLayout() {
  return render(
    <MarketingLayout>
      <span>public page body</span>
    </MarketingLayout>,
  );
}

function readJsonLd(container: HTMLElement): {
  '@graph': Array<Record<string, unknown>>;
} {
  const script = container.querySelector('script[type="application/ld+json"]');
  expect(script).not.toBeNull();
  return JSON.parse(script?.textContent ?? '');
}

describe('(marketing) layout — D134', () => {
  it('renders children without any fetch (no /api/auth/me) and without a QueryClient', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // No QueryClientProvider wrapper on purpose — see header comment.
    renderLayout();

    expect(screen.getByText('public page body')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    // The footer is chrome on every public page, so it links to the privacy
    // policy instead of restating the trust badge (copy budget: trust copy
    // once per flow, at the decision point).
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(footer.getByRole('link', { name: 'All comparisons' })).toHaveAttribute(
      'href',
      '/compare',
    );
    expect(footer.getByRole('link', { name: 'DeclutrMail vs SaneBox' })).toHaveAttribute(
      'href',
      '/vs/sanebox',
    );
    expect(footer.getByRole('link', { name: 'SaneBox alternatives' })).toHaveAttribute(
      'href',
      '/alternatives/sanebox',
    );
    expect(
      footer.getByRole('link', { name: 'How to auto archive emails in Gmail' }),
    ).toHaveAttribute('href', '/how-to/auto-archive-future-emails-in-gmail');
    expect(document.querySelector('[data-dm-privacy-badge]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('(marketing) layout JSON-LD — D132 SEO batch', () => {
  it('limits affected-email previews to mail-moving actions and keeps Keep inline', () => {
    const { container } = renderLayout();
    const app = readJsonLd(container)['@graph'].find(
      (node) => node['@type'] === 'SoftwareApplication',
    );
    const description = String(app?.description);

    expect(description).not.toMatch(/previews every action/i);
    expect(description).toMatch(/Keep.*inline/i);
    expect(description).toMatch(/Archive, Later, and Delete.*Activity/i);
    expect(description).toMatch(/unsubscribe.*request.*cannot/i);
  });

  it('emits Organization + WebSite + SoftwareApplication in a schema.org graph', () => {
    const { container } = renderLayout();
    const graph = readJsonLd(container)['@graph'];

    const org = graph.find((node) => node['@type'] === 'Organization');
    const website = graph.find((node) => node['@type'] === 'WebSite');
    const app = graph.find((node) => node['@type'] === 'SoftwareApplication');
    expect(org).toMatchObject({
      name: 'DeclutrMail',
      url: 'https://declutrmail.com',
      logo: 'https://declutrmail.com/icons/icon-512.png',
      disambiguatingDescription:
        'DeclutrMail is a Gmail cleanup app. It is not affiliated with Decluttr (decluttr.com) or DeclutterMyMail.',
      alternateName: ['Declutr Mail'],
    });
    expect(website).toMatchObject({
      name: 'DeclutrMail',
      url: 'https://declutrmail.com',
      publisher: { '@id': org?.['@id'] },
    });
    // No SearchAction — there is no /search route to point one at.
    expect(website).not.toHaveProperty('potentialAction');
    expect(app).toMatchObject({
      '@id': `${siteUrl()}/#software`,
      name: 'DeclutrMail',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web',
      publisher: { '@id': org?.['@id'] },
    });
    expect(website).not.toHaveProperty('alternateName');
    expect(org).not.toHaveProperty('sameAs');
  });

  it('uses the WS1 offers builder and omits sameAs while the profile list is empty', () => {
    const { container } = renderLayout();
    const graph = readJsonLd(container)['@graph'];
    const org = graph.find((node) => node['@type'] === 'Organization');
    const app = graph.find((node) => node['@type'] === 'SoftwareApplication') as {
      offers: object[];
    };
    expect(app.offers).toEqual(buildOffersJsonLd());
    expect(org).not.toHaveProperty('sameAs');
  });
});
