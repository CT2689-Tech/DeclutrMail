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
import { render, screen } from '@testing-library/react';
import { TIER_MANIFEST } from '@declutrmail/shared';

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
    expect(screen.getByText('We never fetch or store full email contents.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('(marketing) layout JSON-LD — D132 SEO batch', () => {
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
    });
    expect(website).toMatchObject({
      name: 'DeclutrMail',
      url: 'https://declutrmail.com',
      publisher: { '@id': org?.['@id'] },
    });
    // No SearchAction — there is no /search route to point one at.
    expect(website).not.toHaveProperty('potentialAction');
    expect(app).toMatchObject({
      name: 'DeclutrMail',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web',
      publisher: { '@id': org?.['@id'] },
    });
  });

  it('derives one Offer per purchasable price point PER BUYABLE CURRENCY — and never the promo', () => {
    const { container } = renderLayout();
    const app = readJsonLd(container)['@graph'].find(
      (node) => node['@type'] === 'SoftwareApplication',
    ) as {
      offers: Array<{ '@type': string; name: string; price: number; priceCurrency: string }>;
    };

    // A point sells in USD always, and in INR only once Razorpay carries
    // it. Enumerating both beats resolving by request IP: the page quotes
    // the visitor's rail, so a single-currency graph would contradict the
    // rendered price for half the world — but varying the graph by IP
    // would make it change between crawls.
    const expected = Object.values(TIER_MANIFEST)
      .filter((tier) => tier.purchasable)
      .flatMap((tier) =>
        (['monthly', 'annual'] as const).flatMap((cycle) => {
          const price = tier.prices[cycle];
          if (!price) return [];
          const name = price.usdCents === 0 ? tier.name : `${tier.name} — ${cycle}`;
          const offers = [{ name, price: price.usdCents / 100, priceCurrency: 'USD' }];
          if (price.razorpayPlanId !== null) {
            offers.push({ name, price: price.inrPaise / 100, priceCurrency: 'INR' });
          }
          return offers;
        }),
      );

    expect(
      app.offers.map(({ name, price, priceCurrency }) => ({ name, price, priceCurrency })),
    ).toEqual(expected);
    // Razorpay is live, so INR offers must actually be present — an
    // all-USD graph would mean the clamp silently reverted.
    expect(app.offers.some((offer) => offer.priceCurrency === 'INR')).toBe(true);
    expect(app.offers.every((offer) => offer['@type'] === 'Offer')).toBe(true);
    // The Founding Pro promo is a limited-redemption price — it must
    // not be baked into structured data that cannot expire with it.
    const promoPrice = TIER_MANIFEST.pro.promo!.annual.usdCents / 100;
    expect(app.offers.some((offer) => offer.price === promoPrice)).toBe(false);
    expect(app.offers.some((offer) => /founding/i.test(offer.name))).toBe(false);
  });
});
