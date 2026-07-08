/**
 * Landing page tests (D134, D223, D227, D228).
 *
 * Rendered WITHOUT a QueryClientProvider on purpose — structural proof
 * the landing has no TanStack/auth dependency in its tree. The only
 * network the page may touch is the masthead's non-blocking session
 * probe, stubbed here to the anonymous-visitor 401.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { installFetchStub } from '@/test/fetch-stub';
import LandingPage, { metadata } from './page';

function renderLanding() {
  installFetchStub([
    {
      method: 'GET',
      path: '/api/auth/me',
      respond: () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
    },
  ]);
  return render(<LandingPage />);
}

describe('landing page — D134', () => {
  it('renders the locked D223 headline as the page h1', () => {
    renderLanding();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Control Gmail by sender, not by email.');
  });

  it('mounts the D228 trust copy via the shared PrivacyBadge (trust strip + privacy section + footer)', () => {
    const { container } = renderLanding();
    // Headline appears once per badge mount; the storage list rides along.
    expect(screen.getAllByText('Full bodies fetched: 0').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('[data-dm-privacy-badge]').length).toBeGreaterThanOrEqual(3);
  });

  it('never renders banned privacy phrasing (D228) or a user-facing "Screen" verb (D227)', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('bodies read');
    expect(text.toLowerCase()).not.toContain('body read');
    // "Screener" (the feature name) is allowed; bare "Screen" is not.
    expect(/Screen(?!er)/.test(text)).toBe(false);
    // Legal terms are founder-confirmed (2026-07-08); no page may still
    // carry the interim "Pending confirmation" marker.
    expect(text).not.toContain('Pending confirmation');
  });

  it('states the canonical refund terms in the FAQ: 30-day guarantee + full-terms link (D121)', () => {
    const { container } = renderLanding();
    const faqAnswers = Array.from(container.querySelectorAll('.dm-mkt-faq-a'));
    const refundAnswer = faqAnswers.find((el) =>
      el.textContent?.includes('30-day money-back guarantee'),
    );
    expect(refundAnswer).toBeDefined();
    expect(refundAnswer?.textContent).toContain('every paid plan');
    const link = refundAnswer?.querySelector('a[href="/refunds"]');
    expect(link?.textContent).toContain('See the refund policy for full terms');
  });

  it('explains the ritual with all five canonical verbs (D227 + ADR-0019)', () => {
    const { container } = renderLanding();
    const ritualVerbs = Array.from(container.querySelectorAll('.dm-mkt-ritual-verb')).map(
      (el) => el.textContent,
    );
    expect(ritualVerbs).toEqual(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']);
    // The hero demo card carries the same five, from the same registry.
    const demoVerbs = Array.from(container.querySelectorAll('.dm-mkt-ledger-verb kbd')).map(
      (el) => el.textContent,
    );
    expect(demoVerbs).toEqual(['K', 'A', 'U', 'L', 'D']);
  });

  it('points the primary CTA at the OAuth start endpoint and links the legal + pricing routes', () => {
    const { container } = renderLanding();
    const ctas = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(ctas.filter((href) => href?.endsWith('/api/auth/google/start')).length).toBeGreaterThan(
      0,
    );
    for (const route of ['/pricing', '/privacy', '/terms', '/refunds', '/cookies']) {
      expect(ctas).toContain(route);
    }
  });

  it('carries the D223 headline + subcopy into page metadata', () => {
    expect(metadata.description).toContain('handful of sender decisions');
    expect(JSON.stringify(metadata.title)).toContain('Control Gmail by sender, not by email.');
  });

  it('emits FAQPage JSON-LD mirroring the rendered FAQ verbatim (D132 SEO batch)', () => {
    const { container } = renderLanding();
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
