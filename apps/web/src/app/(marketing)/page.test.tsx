/**
 * Landing page tests (D134, D223, D227, D228).
 *
 * Rendered WITHOUT a QueryClientProvider on purpose — structural proof
 * the landing has no TanStack/auth dependency in its tree. The only
 * network the page may touch is the masthead's non-blocking session
 * probe, stubbed here to the anonymous-visitor 401.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { actionHelpCopy, VERB_REGISTRY } from '@declutrmail/shared/actions';
import { METER, MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { installFetchStub } from '@/test/fetch-stub';
import LandingPage, { metadata } from './page';
import { FinalCta } from '@/features/marketing/landing/footer';
import { Hero } from '@/features/marketing/landing/hero';

// No edge geo outside Vercel — the header is genuinely absent locally,
// in CI, and on any self-hosted deployment, so the empty set IS the
// common production case and the one the assertions below describe
// (Paddle/USD).
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

async function renderLanding() {
  installFetchStub([
    {
      method: 'GET',
      path: '/api/auth/me',
      respond: () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
    },
  ]);
  // The pricing teaser is a lazily loaded island; wait for it so every
  // assertion sees the whole page.
  const view = render(<LandingPage />);
  await screen.findByTestId('pricing-teaser-story');
  return view;
}

describe('landing page — D134', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  // The headline's wording is copy, free to change; one non-empty h1 that
  // labels the hero is the structure search and screen readers rely on.
  it('renders exactly one non-empty h1, as the hero heading', async () => {
    const { container } = await renderLanding();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    const [h1] = headings;
    expect(h1?.textContent?.trim()).toBeTruthy();
    expect(container.querySelector('.dm-mkt-hero')?.getAttribute('aria-labelledby')).toBe(h1?.id);
  });

  it('states the trust copy in Privacy, plus one collapsed scope disclosure', async () => {
    const { container } = await renderLanding();
    // Marketing pages may lead with or repeat the exact privacy sentence
    // (CLAUDE.md §8.5, founder decision 2026-11-17); Privacy must carry it.
    expect(container.querySelector('#privacy')?.textContent).toContain(PRIVACY_BADGE_HEADLINE);
    expect(container.querySelectorAll('details.dm-mkt-scope')).toHaveLength(1);
    expect(container.querySelector('.dm-home-inventory-lists')).toBeInTheDocument();
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
    // The verb "Screen" is banned as a whole word. "Screener" (the feature
    // name), "Screenshots" and "Screen reader" are other words.
    expect(text).not.toMatch(/\bScreen\b(?! readers?\b)/);
    // Legal terms are founder-confirmed (2026-07-08); no page may still
    // carry the interim "Pending confirmation" marker.
    expect(text).not.toContain('Pending confirmation');
  });

  it('composes hero, principles, close-up, steps, companion, tools, privacy, pricing and final CTA', async () => {
    const { container } = await renderLanding();
    expect(container.querySelectorAll('.dm-mkt-landing > section')).toHaveLength(9);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'See the sender. Know what will change.',
      'Five decisions. A preview before anything moves.',
      'Keep your inbox. Get a better way to decide.',
      'A clearer inbox is only the beginning.',
      'Know what we see. Keep the final say.',
      'Free to start. Pay once to clear the rest.',
      'Start with one sender.',
    ]);
    // The in-page section index and the values strip are gone; the
    // principles carry those three ideas with a sentence each.
    expect(container.querySelector('nav')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Product principles' })).getByText(
        'Keep the final say',
      ),
    ).toBeInTheDocument();
    // No mono "№ 02 — …" eyebrows, and no FAQ block — so no FAQPage
    // JSON-LD either: Google only allows FAQ markup for answers the page
    // visibly renders. /faq and /help carry it.
    expect(container.textContent).not.toContain('№');
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it('describes the preview step as a matching count and planned Gmail change', async () => {
    const { container } = await renderLanding();
    const steps = container.querySelector('#how-it-works ol');
    expect(steps?.textContent).toMatch(/matching count and the planned Gmail change/i);
    expect(steps?.textContent).not.toMatch(/which emails will move/i);
    expect(
      Array.from(steps?.querySelectorAll('li') ?? []).map((li) => li.firstChild?.textContent),
    ).toEqual(['1Inspect', '2Preview', '3Result', '4Undo']);
  });

  it('teaches the five decisions in K/A/U/L/D order with the registry semantics', async () => {
    const { container } = await renderLanding();
    const verbs = within(screen.getByRole('list', { name: 'The five decisions' }));
    const cards = verbs.getAllByRole('listitem');
    expect(cards.map((card) => card.querySelector('kbd')?.textContent)).toEqual([
      'K',
      'A',
      'U',
      'L',
      'D',
    ]);
    VERB_REGISTRY.forEach((verb, index) => {
      expect(cards[index]?.querySelector('strong')?.textContent).toBe(verb.label);
      expect(cards[index]?.textContent).toContain(actionHelpCopy(verb.id));
    });
    // Keep must never read as protection or a permanent exclusion.
    expect(container.textContent).not.toMatch(/stops coming up for review/i);
  });

  it('explains why the workspace sits beside Gmail', async () => {
    const { container } = await renderLanding();
    const workflow = container.querySelector('#works-with-gmail');
    expect(workflow?.textContent).toContain('Your mail stays in your existing Gmail account');
    expect(workflow?.textContent).toContain('Read and reply');
    expect(workflow?.textContent).toContain('Review and clean up');
  });

  it('states the canonical refund terms beside the prices (D121)', async () => {
    const { container } = await renderLanding();
    const foot = container.querySelector('.dm-mkt-pricing-foot');
    expect(foot?.textContent).toContain('14-day money-back on any purchase, once per customer.');
  });

  it('renders the launch teaser: Free, the Backlog Pass and Plus at launch prices', async () => {
    const { container } = await renderLanding();
    const plans = container.querySelector('#plans');
    const text = plans?.textContent ?? '';
    expect(text).toContain('$59');
    expect(text).not.toMatch(/\$9\s*\/\s*month/);
    expect(text).not.toContain('$129');
    // v1 promised a 30-day refund; "30-day Undo" in the free list is fine.
    expect(text).not.toMatch(/30-day money-back/);
    // The one-time pass is the highlighted card, badged "Pay once".
    const highlighted = plans?.querySelector('[data-highlighted]');
    expect(highlighted?.querySelector('h3')?.textContent).toBe('Backlog Pass');
    expect(highlighted?.textContent).toContain('Pay once');
    expect(highlighted?.textContent).toContain('Never renews');
    expect(Array.from(plans?.querySelectorAll('h3') ?? []).map((h) => h.textContent)).toEqual([
      'Free',
      'Backlog Pass',
      'Plus',
    ]);
  });

  it('keeps the complete data list available without making it the first trust message', async () => {
    const { container } = await renderLanding();
    expect(container.querySelector('.dm-home-inventory')).not.toHaveAttribute('open');
    expect(container.querySelector('.dm-home-inventory summary')?.textContent).toBe(
      'Full data list',
    );
  });

  it('names which actions carry the recovery window', async () => {
    const { container } = await renderLanding();
    const text = container.querySelector('#how-it-works')?.textContent ?? '';
    expect(text).toContain(
      `Archive, Later and Delete have ${MIN_UNDO_WINDOW_DAYS} days of Activity Undo.`,
    );
  });

  it('previews an Archive in the hero with its count, destination and undo, nothing focusable', async () => {
    const { container } = await renderLanding();
    const figure = container.querySelector('.dm-home-preview-figure') as HTMLElement;
    const preview = within(figure).getByRole('img', { name: /Illustrative Archive preview/ });
    expect(preview.textContent).toContain('Fictional sample');
    expect(preview.textContent).toContain('Archive 128 emails');
    expect(preview.textContent).toContain('Moves out of your inbox, stays in Gmail.');
    expect(preview.textContent).toContain(`Undo from Activity for ${MIN_UNDO_WINDOW_DAYS} days.`);
    expect(figure.querySelector('button, a, [tabindex], input')).toBeNull();
    expect(Array.from(figure.querySelectorAll('kbd')).map((kbd) => kbd.textContent)).toEqual(
      VERB_REGISTRY.map((verb) => verb.shortcut),
    );
  });

  it('shows the sender list and right-hand details as a clearly illustrative close-up', async () => {
    const { container } = await renderLanding();
    const figure = container.querySelector(
      '#product-tour .dm-mkt-hero-workspace-figure',
    ) as HTMLElement;
    expect(figure.querySelector('figcaption')?.textContent).toMatch(/fictional sample/i);
    expect(figure.querySelector('.dm-mkt-hero-workspace-list')?.textContent).toContain(
      'Fieldnotes',
    );
    expect(figure.querySelector('.dm-mkt-hero-workspace-detail')?.textContent).toContain('128');
    expect(
      screen.getByRole('img', {
        name: /Illustrative DeclutrMail workspace.*right-hand detail inspector/i,
      }),
    ).toBeInTheDocument();
    // Decorative UI, not controls: nothing in the figure is focusable.
    expect(figure.querySelector('button, a, [tabindex]')).toBeNull();
  });

  // ADR-0036: the locked mark is the only DeclutrMail identity. Both places
  // the page depicts the product itself once drew a "d." stand-in instead.
  // Both sit on an always-dark ground, so the tone must be the pinned
  // `reversed` pair (paper frame) — `duo` would flip to ink on light theme.
  it('draws the brand mark, not a stand-in monogram, wherever it depicts DeclutrMail', async () => {
    const { container } = await renderLanding();
    const productMarks = [
      container.querySelector('.dm-mkt-hero-workspace-rail'),
      container.querySelector('.dm-home-companion-tile-product .dm-home-companion-mark'),
    ];
    for (const mark of productMarks) {
      expect(mark).not.toBeNull();
      expect(mark?.textContent).not.toMatch(/\bd\./);
      const frame = mark?.querySelector('svg path');
      expect(frame?.getAttribute('stroke')).toBe('#FAF4ED');
    }
  });

  it('offers exactly one primary button and one quiet demo link in the hero', async () => {
    const { container } = await renderLanding();
    const hero = container.querySelector('.dm-mkt-hero') as HTMLElement;
    expect(hero.querySelectorAll('.dm-mkt-cta')).toHaveLength(1);
    expect(within(hero).getByRole('link', { name: 'Start free' }).getAttribute('href')).toBe(
      '/sign-in',
    );
    expect(within(hero).getByRole('link', { name: 'Try the demo' })).toHaveAttribute(
      'href',
      '/inbox-simulator?workspace=senders',
    );
    // "Start free" opens the permission checkpoint, which shows the scope
    // in full; the hero keeps one short verification line instead.
    expect(hero.querySelector('details.dm-mkt-scope')).toBeNull();
    const verified = hero.querySelector('.dm-home-verified') as HTMLElement;
    expect(verified.textContent).toContain('Google OAuth verified · CASA Tier 2 assessed');
    expect(verified.textContent).toContain('Gmail only for now.');
    expect(within(verified).getByRole('link', { name: 'Security details' })).toHaveAttribute(
      'href',
      '/security#verification',
    );
  });

  it('sells only buyable plans as tools and points Pro at its waitlist', async () => {
    const { container } = await renderLanding();
    const tools = container.querySelector('#everyday-tools') as HTMLElement;
    const tags = Array.from(tools.querySelectorAll('.dm-home-tag')).map((tag) => tag.textContent);
    expect(tags).toEqual([
      `Screener · ${TIER_MANIFEST.plus.name}`,
      `Autopilot · ${TIER_MANIFEST.plus.name}`,
      `Coming with ${TIER_MANIFEST.pro.name}`,
    ]);
    expect(within(tools).queryByRole('link', { name: /Explore Daily Brief/ })).toBeNull();
    expect(within(tools).queryByRole('link', { name: /Explore Follow-ups/ })).toBeNull();
    expect(tools.textContent).toContain(`${TIER_MANIFEST.pro.name} isn’t available to buy yet.`);
    expect(within(tools).getByRole('link', { name: 'Join the Pro waitlist' })).toHaveAttribute(
      'href',
      '/pricing#pro-waitlist',
    );
  });

  it('points the primary CTA at the permission checkpoint and exposes demo, pricing, and privacy routes', async () => {
    const { container } = await renderLanding();
    const ctas = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(ctas).toContain('/sign-in');
    expect(ctas.some((href) => href?.includes('/api/auth/google/start'))).toBe(false);
    for (const route of ['/inbox-simulator?workspace=senders', '/pricing', '/privacy']) {
      expect(ctas).toContain(route);
    }
  });

  it('carries Gmail cleanup, preview and undo into page metadata', () => {
    expect(metadata.description).toContain('Preview which emails will move before you confirm');
    // Facts, not the exact sentence: SEO title tests must not need a test edit.
    const title = (metadata.title as { absolute?: string } | undefined)?.absolute ?? '';
    expect(title).toMatch(/\bGmail\b/);
    expect(title).toMatch(/DeclutrMail$/);
  });

  describe('D138 verification claim — the item the visitor can check', () => {
    it('links the CASA claim to the page that substantiates it', async () => {
      const { container } = await renderLanding();
      const privacy = within(container.querySelector('#privacy') as HTMLElement);
      const link = privacy.getByRole('link', { name: 'Security details' });
      expect(link.getAttribute('href')).toBe('/security#verification');
      const describedBy = link.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const claim = container.querySelector(`#${describedBy}`);
      expect(claim?.textContent).toContain('CASA Tier 2 assessed by TAC Security');
      // The deck sentence drops its closing privacy line; Privacy's lede
      // already states it once.
      expect(claim?.textContent).not.toContain(PRIVACY_BADGE_HEADLINE);
      expect(claim?.textContent).toMatch(/\.$/);
    });

    it('claims only an APPROVED OAuth verification, never a certification', async () => {
      const { container } = await renderLanding();
      const text = `${container.querySelector('#privacy')?.textContent ?? ''} ${
        container.querySelector('.dm-home-verified')?.textContent ?? ''
      }`;
      expect(text).toContain('Google OAuth verification approved');
      // Google approved a verification for one restricted scope. It did
      // not certify or audit the product, and the page must never say
      // it did — /security#verification is the bound on this wording.
      for (const overstatement of ['certified', 'audited', 'Certified', 'Audited']) {
        expect(text).not.toContain(overstatement);
      }
    });
  });

  it('uses one label for both primary permission-entry CTAs', async () => {
    const { container } = await renderLanding();
    const labels = Array.from(container.querySelectorAll('a.dm-mkt-cta[href="/sign-in"]')).map(
      (a) => a.textContent,
    );
    expect(labels).toEqual(['Start free', 'Start free']);
  });
});

describe('Hero disclaimer — states the Free-tier cap (QA-sign-in-05)', () => {
  it('mentions the free email meter alongside the undo window', () => {
    render(<Hero />);
    const disclaimer = screen.getByText(/No card required/i);
    const allowance = METER.free.limit.toLocaleString('en-US');
    expect(disclaimer.textContent).toContain(`${allowance} emails cleared a month`);
  });
});

describe('Final CTA — links to the pre-consent explanation page (QA-sign-in-06)', () => {
  it('offers a low-key link to /sign-in beside the OAuth disclosure', () => {
    render(<FinalCta />);
    const link = screen.getByRole('link', { name: /what DeclutrMail can and can.t access/i });
    expect(link).toHaveAttribute('href', '/sign-in');
  });
});
