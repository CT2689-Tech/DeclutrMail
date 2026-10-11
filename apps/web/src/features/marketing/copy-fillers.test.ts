/**
 * A sentence that needs an empty filler must disappear whole.
 * This file is the regression for the partial sentences that shipped
 * on 75fc956e: "/vs" FAQs, the comparison price cells, FAQPage JSON-LD,
 * and both llms documents. After WS1a landed, the live catalog fills
 * Free and Plus; pass price, pass days, and refund days stay blank,
 * so those clauses stay omitted.
 */

import { describe, expect, it } from 'vitest';

import { planName, renderPricingMarkdown } from '@declutrmail/shared/entitlements';

import { COMPARISONS } from './comparison/comparison-data';
import { comparisonFaqJsonLd, comparisonFaqs } from './comparison/comparison-faqs';
import { renderLlmsFullTxt, renderLlmsTxt } from './llms/llms-document';

const BROKEN = [/\{[A-Za-z0-9_]+\}/, / {2,}/, /,\s*,/, /,\s*;/, / is {2}/, /(^|[.!?]\s+)-day\b/m];

function expectNoEmptyHeadings(text: string, where: string): void {
  for (const match of text.matchAll(/^##[^\n]+$/gm)) {
    const start = (match.index ?? 0) + match[0].length;
    const rest = text.slice(start);
    const next = rest.search(/^##/m);
    const body = (next === -1 ? rest : rest.slice(0, next)).trim();
    expect(body, `${where} empty heading ${match[0]}`).not.toBe('');
  }
}

function expectClean(text: string, where: string): void {
  for (const pattern of BROKEN) {
    expect(text, `${where} matched ${pattern}`).not.toMatch(pattern);
  }
  expectNoEmptyHeadings(text, where);
}

const catalogEmpty = planName('free') === '' || planName('plus') === '';

describe('empty WS1 fillers', () => {
  it('omits incomplete pricing sentences on every comparison', () => {
    for (const comparison of COMPARISONS) {
      const price = comparison.rows.find((row) => row.label === 'Public starting point');
      expect(price, comparison.slug).toBeTruthy();
      const summary = price!.declutrMail.summary;
      const detail = price!.declutrMail.detail ?? '';
      expect(summary, comparison.slug).not.toBe(', ');
      expect(summary, comparison.slug).not.toMatch(/^[\s,;]+$/);
      expectClean(`${summary} ${detail}`, `${comparison.slug} price`);
      if (catalogEmpty) {
        expect(summary, comparison.slug).toBe('');
        expect(detail, comparison.slug).toBe('');
      }

      const faqs = comparisonFaqs(comparison);
      const json = JSON.stringify(comparisonFaqJsonLd(comparison));
      expectClean(faqs.map((faq) => `${faq.q} ${faq.a}`).join('\n'), `${comparison.slug} faq`);
      expectClean(json, `${comparison.slug} jsonld`);
      if (catalogEmpty) {
        expect(faqs.some((faq) => faq.q === 'How much does DeclutrMail cost?')).toBe(false);
        expect(json).not.toContain('How much does DeclutrMail cost?');
      } else {
        expect(summary.trim(), comparison.slug).not.toBe('');
        expect(faqs.some((faq) => faq.q === 'How much does DeclutrMail cost?')).toBe(true);
      }
    }
  });

  it('drops the Autopilot clause on gmail-filters while the plan name is empty', () => {
    const filters = COMPARISONS.find((comparison) => comparison.slug === 'gmail-filters');
    expect(filters).toBeTruthy();
    const answer = comparisonFaqs(filters!)
      .map((faq) => faq.a)
      .join('\n');
    expect(answer).toContain('showing them ranked first');
    expect(answer).not.toContain('{plusName}');
    expect(answer).not.toMatch(/Autopilot rules \(on\s*\)/);
    expect(JSON.stringify(comparisonFaqJsonLd(filters!))).not.toContain('{plusName}');
  });

  it('keeps llms.txt and llms-full.txt free of empty fillers and false verification', () => {
    const llms = renderLlmsTxt();
    const full = renderLlmsFullTxt();
    expectClean(llms, 'llms.txt');
    expectClean(full, 'llms-full.txt');
    expect(llms).toContain('Google OAuth verification for gmail.modify approved April 21, 2026');
    expect(llms).toContain('brand verification approved August 18, 2026');
    expect(llms).toContain('CASA Tier 2 letter of validation submitted April 15, 2026');
    expect(llms).not.toMatch(/under CASA/);
    expect(llms).not.toMatch(/\bcertified\b/i);
    expect(llms).not.toMatch(/\baudited\b/i);
    expect(llms).not.toMatch(/Autopilot rules on\s+handle/);
    expect(llms).not.toMatch(/Pricing:\s*,/);
    if (renderPricingMarkdown().trim() === '') {
      expect(llms).not.toMatch(/^## Pricing\s*$/m);
      expect(full).not.toMatch(/^## Pricing\s*$/m);
    }
    expect(full).toContain(llms.trim());
  });
});
