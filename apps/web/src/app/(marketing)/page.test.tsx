/**
 * Landing page tests (D134, D223, D227, D228).
 *
 * Rendered WITHOUT a QueryClientProvider on purpose — structural proof
 * the landing has no TanStack/auth dependency in its tree. The only
 * network the page may touch is the masthead's non-blocking session
 * probe, stubbed here to the anonymous-visitor 401.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import { installFetchStub } from '@/test/fetch-stub';
import LandingPage, { metadata } from './page';
import { FinalCta } from '@/features/marketing/landing/footer';
import { Hero } from '@/features/marketing/landing/hero';

// No edge geo outside Vercel — the header is genuinely absent locally,
// in CI, and on any self-hosted deployment, so the empty set IS the
// common production case and the one the assertions below describe
// (Paddle/USD). `pricing-region.test.tsx` covers the India rail.
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

async function renderLanding() {
  installFetchStub([
    {
      method: 'GET',
      path: '/api/auth/me',
      respond: () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
    },
  ]);
  // `LandingPage` is an async server component (it reads the edge geo
  // header for the pricing teaser's rail — see its docblock), so it is
  // invoked and awaited the way Next invokes it, then handed to RTL as
  // a plain element tree.
  return render(await LandingPage());
}

describe('landing page — D134', () => {
  it('renders the launch headline as the page h1', async () => {
    await renderLanding();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Clear years of clutter, one sender at a time.');
    // One ink colour: no accented phrase inside the headline.
    expect(h1.querySelector('em, i, b, strong, span')).toBeNull();
  });

  it('states the D228 trust copy once: the badge, plus the collapsed scope disclosures', async () => {
    const { container } = await renderLanding();
    // The locked headline used to appear seven times on this page. It now
    // is VISIBLE once, in the PrivacyBadge card. The only other copies sit
    // inside the collapsed OAuth scope disclosures (which quote it
    // verbatim) — one beside each CTA that starts Google OAuth.
    const visible = container.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('details').forEach((d) => d.remove());
    expect((visible.textContent ?? '').split(PRIVACY_BADGE_HEADLINE).length - 1).toBe(1);
    expect(container.querySelectorAll('details.dm-mkt-scope')).toHaveLength(2);
    expect(container.querySelectorAll('[data-dm-privacy-badge="card"]')).toHaveLength(1);
    // What actually needs guarding is that the generated list reaches the
    // page, so assert it directly rather than via a mount count.
    for (const item of PRIVACY_STORAGE_ITEMS) {
      expect(container.textContent).toContain(item);
    }
  });

  it('never renders banned privacy phrasing (D228) or a user-facing "Screen" verb (D227)', async () => {
    const { container } = await renderLanding();
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('bodies read');
    expect(text.toLowerCase()).not.toContain('body read');
    expect(text.toLowerCase()).not.toContain('full bodies fetched');
    expect(text).not.toMatch(/\bverbs?\b/i);
    expect(text).not.toMatch(/product chapters|quota bands|methodology/i);
    // "Screener" (the feature name) is allowed; bare "Screen" is not.
    expect(/Screen(?!er)/.test(text)).toBe(false);
    // Legal terms are founder-confirmed (2026-07-08); no page may still
    // carry the interim "Pending confirmation" marker.
    expect(text).not.toContain('Pending confirmation');
  });

  it('is five blocks: hero, how it works, privacy, pricing, final CTA', async () => {
    const { container } = await renderLanding();
    expect(container.querySelectorAll('.dm-mkt-landing > section')).toHaveLength(5);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
    // No mono "№ 02 — …" eyebrows, and no FAQ block — so no FAQPage
    // JSON-LD either: Google only allows FAQ markup for answers the page
    // visibly renders. /faq and /help carry it.
    expect(container.textContent).not.toContain('№');
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it('names all five user actions from the registry (D227 + ADR-0019)', async () => {
    const { container } = await renderLanding();
    const workflow = container.querySelector('#how-it-works');
    expect(workflow?.textContent).toContain('Keep, Archive, Unsubscribe, Later, or Delete');
    // The Review step's vignette carries the same five, from the same registry.
    const demoVerbs = Array.from(container.querySelectorAll('.dm-mkt-vig-verb')).map(
      (el) => el.textContent,
    );
    expect(demoVerbs).toEqual(['KKeep', 'AArchive', 'UUnsubscribe', 'LLater', 'DDelete']);
  });

  it('states the canonical refund terms beside the prices (D121)', async () => {
    const { container } = await renderLanding();
    const foot = container.querySelector('.dm-mkt-pricing-foot');
    expect(foot?.textContent).toContain('30-day money-back guarantee');
    expect(foot?.textContent).toContain('every paid plan');
  });

  it('labels the sample-inbox arithmetic as an illustration', async () => {
    const { container } = await renderLanding();
    const workflow = container.querySelector('#how-it-works');
    expect(workflow?.textContent).toContain('12,418');
    expect(workflow?.textContent).toContain('143');
    expect(workflow?.textContent).toMatch(/illustrative/i);
  });

  it('states the undo window once, with the one decision Undo cannot reach', async () => {
    const { container } = await renderLanding();
    const text = container.textContent ?? '';
    expect(text.split(`${MIN_UNDO_WINDOW_DAYS} days`).length - 1).toBe(1);
    expect(text).toMatch(/unsubscribe requests cannot be taken back/i);
  });

  it('settles the hero inbox on a confirm card that states the count and where email goes', async () => {
    const { container } = await renderLanding();
    const figure = container.querySelector('.dm-mkt-inbox-figure') as HTMLElement;
    // Labelled as an illustration, visibly and to assistive tech.
    expect(figure.querySelector('figcaption')?.textContent).toMatch(/illustrative/i);
    const confirm = figure.querySelector('.dm-mkt-inbox-confirm');
    // The preview owes the count and where the email goes (D226).
    expect(confirm?.textContent).toContain('Archive 412 emails?');
    expect(confirm?.textContent).toContain('stay in Gmail');
    expect(
      screen.getByRole('img', { name: /Illustrative inbox.*Archive 412 emails from LinkedIn/i }),
    ).toBeInTheDocument();
    // Decorative UI, not controls: nothing in the figure is focusable.
    expect(figure.querySelector('button, a, [tabindex]')).toBeNull();
  });

  it('offers exactly one primary button and one quiet demo link in the hero', async () => {
    const { container } = await renderLanding();
    const hero = container.querySelector('.dm-mkt-hero') as HTMLElement;
    expect(hero.querySelectorAll('.dm-mkt-cta')).toHaveLength(1);
    expect(within(hero).getByRole('link', { name: 'Start free' }).getAttribute('href')).toMatch(
      /\/api\/auth\/google\/start$/,
    );
    expect(within(hero).getByRole('link', { name: /Try the demo/ })).toHaveAttribute(
      'href',
      '/inbox-simulator',
    );
    // "Start free" goes straight to Google's consent screen, so the
    // pre-consent disclosure sits beside it — collapsed.
    const disclosure = hero.querySelector('details.dm-mkt-scope');
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute('open');
  });

  it('points the primary CTA at OAuth and exposes demo, pricing, and privacy routes', async () => {
    const { container } = await renderLanding();
    const ctas = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(ctas.filter((href) => href?.endsWith('/api/auth/google/start')).length).toBeGreaterThan(
      0,
    );
    for (const route of ['/inbox-simulator', '/pricing', '/privacy']) {
      expect(ctas).toContain(route);
    }
  });

  it('carries sender cleanup and preview positioning into page metadata', () => {
    expect(metadata.description).toContain('Preview which emails will move before you confirm');
    expect(JSON.stringify(metadata.title)).toContain('Clean up Gmail, one sender at a time');
  });

  describe('D138 verification claim — the item the visitor can check', () => {
    it('links the CASA claim to the page that substantiates it', async () => {
      const { container } = await renderLanding();
      const link = Array.from(container.querySelectorAll('a')).find((a) =>
        a.textContent?.includes('CASA Tier 2'),
      );
      expect(link).toBeDefined();
      expect(link?.getAttribute('href')).toBe('/security#verification');
    });

    it('claims only an APPROVED OAuth verification, never a certification', async () => {
      const { container } = await renderLanding();
      const text = container.querySelector('#privacy')?.textContent ?? '';
      expect(text).toContain('Google OAuth verification approved');
      // Google approved a verification for one restricted scope. It did
      // not certify or audit the product, and the page must never say
      // it did — /security#verification is the bound on this wording.
      for (const overstatement of ['certified', 'audited', 'Certified', 'Audited']) {
        expect(text).not.toContain(overstatement);
      }
    });
  });

  it('uses one label for every CTA that starts Google sign-in', async () => {
    const { container } = await renderLanding();
    const labels = Array.from(container.querySelectorAll('a[href$="/api/auth/google/start"]')).map(
      (a) => a.textContent,
    );
    expect(labels).toEqual(['Start free', 'Start free']);
  });
});

describe('Hero disclaimer — states the Free-tier cap (QA-sign-in-05)', () => {
  it('mentions the monthly cleanup-action cap alongside the undo window', () => {
    render(<Hero />);
    const disclaimer = screen.getByText(/No credit card/i);
    expect(disclaimer.textContent).toMatch(/50 cleanup actions a month/i);
  });
});

describe('Final CTA — links to the pre-consent explanation page (QA-sign-in-06)', () => {
  it('offers a low-key link to /sign-in beside the OAuth disclosure', () => {
    render(<FinalCta />);
    const link = screen.getByRole('link', { name: /what DeclutrMail can and can.t access/i });
    expect(link).toHaveAttribute('href', '/sign-in');
  });
});
