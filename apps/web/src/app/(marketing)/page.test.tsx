/**
 * Landing page tests (D134, D223, D227, D228).
 *
 * Rendered WITHOUT a QueryClientProvider on purpose — structural proof
 * the landing has no TanStack/auth dependency in its tree. The only
 * network the page may touch is the masthead's non-blocking session
 * probe, stubbed here to the anonymous-visitor 401.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { installFetchStub } from '@/test/fetch-stub';
import LandingPage, { metadata } from './page';
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
  it('renders the locked D250 headline as the page h1', async () => {
    await renderLanding();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(
      'Clear thousands of emails by sender — and see exactly what moves.',
    );
  });

  it('mounts the D228 trust copy via the shared PrivacyBadge (trust strip + privacy section)', async () => {
    const { container } = await renderLanding();
    // Headline appears once per badge mount; the storage list rides along.
    expect(
      screen.getAllByText('We never fetch or store full email contents.').length,
    ).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('[data-dm-privacy-badge]').length).toBeGreaterThanOrEqual(2);
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

  it('states the canonical refund terms in the FAQ: 30-day guarantee + full-terms link (D121)', async () => {
    const { container } = await renderLanding();
    const faqAnswers = Array.from(container.querySelectorAll('.dm-mkt-faq-a'));
    const refundAnswer = faqAnswers.find((el) =>
      el.textContent?.includes('30-day money-back guarantee'),
    );
    expect(refundAnswer).toBeDefined();
    expect(refundAnswer?.textContent).toContain('every paid plan');
    const link = refundAnswer?.querySelector('a[href="/refunds"]');
    expect(link?.textContent).toContain('See the refund policy for full terms');
  });

  it('explains all five user actions (D227 + ADR-0019)', async () => {
    const { container } = await renderLanding();
    const workflow = container.querySelector('#how-it-works');
    expect(workflow).not.toBeNull();
    const ritualVerbs = Array.from(container.querySelectorAll('.dm-mkt-ritual-verb')).map(
      (el) => el.textContent,
    );
    expect(ritualVerbs).toEqual(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']);
    expect(workflow?.querySelectorAll('.dm-mkt-ritual-verb')).toHaveLength(5);
    expect(container.querySelector('.dm-mkt-product-tour')).toBeNull();
    expect(container.querySelector('.dm-mkt-gmail-map')).toBeNull();
    // The hero demo card carries the same five, from the same registry.
    const demoVerbs = Array.from(container.querySelectorAll('.dm-mkt-ledger-verb kbd')).map(
      (el) => el.textContent,
    );
    expect(demoVerbs).toEqual(['K', 'A', 'U', 'L', 'D']);
  });

  it('leaves the one-shot hero demo on an informative completed state', async () => {
    const { container } = await renderLanding();
    const receipt = container.querySelector('.dm-mkt-ledger-receipt');
    expect(receipt?.textContent).toContain('412 messages archived from Inbox');
    expect(receipt?.textContent).toContain('Still searchable in All Mail');
    expect(receipt?.textContent).toContain('existing email only');
    expect(
      screen.getByRole('img', {
        name: /412 messages leave Inbox, remain searchable in All Mail, affect existing email only/i,
      }),
    ).toBeInTheDocument();
  });

  it('lets a visitor pause, replay, or enter the interactive decision', async () => {
    const { container } = await renderLanding();
    const ledger = container.querySelector('.dm-mkt-ledger');
    expect(ledger).toHaveAttribute('data-run', '0');

    fireEvent.click(screen.getByRole('button', { name: 'Pause demo' }));
    expect(screen.getByRole('button', { name: 'Resume demo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(ledger).toHaveAttribute('data-paused', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(container.querySelector('.dm-mkt-ledger')).toHaveAttribute('data-run', '1');
    expect(screen.getByRole('link', { name: 'Try this decision →' })).toHaveAttribute(
      'href',
      '/inbox-simulator',
    );
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

  it('carries the D250 positioning into page metadata', () => {
    expect(metadata.description).toContain('Keep, Archive, Unsubscribe, Later, and Delete');
    expect(JSON.stringify(metadata.title)).toContain('Preview Gmail cleanup by sender');
  });

  describe('D138 trust strip — the verification item the visitor can check', () => {
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
      const strip = container.querySelector('.dm-mkt-trust');
      const text = strip?.textContent ?? '';
      expect(text).toContain('Google OAuth verification approved');
      // Google approved a verification for one restricted scope. It did
      // not certify or audit the product, and the strip must never say
      // it did — /security#verification is the bound on this wording.
      for (const overstatement of ['certified', 'audited', 'Certified', 'Audited']) {
        expect(text).not.toContain(overstatement);
      }
    });
  });

  it('emits FAQPage JSON-LD mirroring the rendered FAQ verbatim (D132 SEO batch)', async () => {
    const { container } = await renderLanding();
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const faq = scripts
      .map((s) => JSON.parse(s.textContent ?? '') as Record<string, unknown>)
      .find((data) => data['@type'] === 'FAQPage') as {
      '@context': string;
      mainEntity: Array<{
        '@type': string;
        name: string;
        acceptedAnswer: { '@type': string; text: string };
      }>;
    };
    expect(faq).toBeDefined();
    expect(faq['@context']).toBe('https://schema.org');

    // Google requires marked-up Q&A to appear on the page: every
    // Question must match a rendered <details> pair, in order.
    const rendered = Array.from(container.querySelectorAll('.dm-mkt-faq details'));
    expect(faq.mainEntity).toHaveLength(rendered.length);
    faq.mainEntity.forEach((question, i) => {
      expect(question['@type']).toBe('Question');
      expect(question.acceptedAnswer['@type']).toBe('Answer');
      expect(question.name).toBe(rendered[i]?.querySelector('summary')?.textContent);
      // The answer text (minus the optional trailing <a> markup) must
      // be the rendered answer copy.
      const plain = question.acceptedAnswer.text.replace(/ <a href=[^>]*>.*<\/a>$/, '');
      expect(rendered[i]?.querySelector('.dm-mkt-faq-a')?.textContent).toContain(plain);
    });
  });
});

describe('Hero subhead — names the tier for a Plus-only claim', () => {
  it('names Plus when describing Autopilot rules (bypasses renderLanding — Hero has no server data dependency)', () => {
    render(<Hero />);
    const subhead = screen.getByText(/turn on a rule/i);
    expect(subhead.textContent).toMatch(/plus/i);
  });
});

describe('Hero disclaimer — states the Free-tier cap (QA-sign-in-05)', () => {
  it('mentions the monthly cleanup-action cap alongside the undo window', () => {
    render(<Hero />);
    const disclaimer = screen.getByText(/no card/i);
    expect(disclaimer.textContent).toMatch(/50 cleanup actions a month/i);
  });
});

describe('Hero — links to the pre-consent explanation page (QA-sign-in-06)', () => {
  it('offers a low-key link to /sign-in beside the OAuth disclosure', () => {
    render(<Hero />);
    const link = screen.getByRole('link', { name: /what DeclutrMail can and can.t access/i });
    expect(link).toHaveAttribute('href', '/sign-in');
  });
});
