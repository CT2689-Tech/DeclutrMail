/**
 * llms.txt reconciliation (D132 SEO batch, AEO/GEO).
 *
 * `/llms.txt` is a generated guide for LLM crawlers, but it must
 * not drift out of sync with the actual public surface — `/cookies` was
 * missing and `/beta` was in neither llms.txt nor the sitemap. This pins
 * the served text to the SAME `MARKETING_PATHS` array the sitemap is built
 * from, so the three (routes → sitemap → llms.txt) reconcile through one
 * source and the next omission fails here. The pricing changelog is not
 * in that array: it is appended only while `PRICING_V2` is on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fillWs3, llmsStorageAiLine, WS3_COPY } from '@declutrmail/shared/copy/launch';
import { renderPricingMarkdown } from '@declutrmail/shared/entitlements';

import { renderLlmsFullTxt, renderLlmsTxt } from '@/features/marketing/llms/llms-document';

import { MARKETING_PATHS } from './sitemap';

const LLMS_TXT = renderLlmsTxt();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('llms.txt — marketing surface reconciliation', () => {
  it.each(MARKETING_PATHS)('references the public marketing route %s', (route) => {
    // The homepage is linked via its in-page anchor (/#how-it-works);
    // every other route by its absolute canonical URL.
    const needle = route === '/' ? 'https://declutrmail.com/#' : `https://declutrmail.com${route}`;
    expect(renderLlmsTxt()).toContain(needle);
  });

  it('omits /pricing/changelog while PRICING_V2 is off', () => {
    vi.stubEnv('PRICING_V2', '');
    expect(renderLlmsTxt()).not.toContain('https://declutrmail.com/pricing/changelog');
  });

  it('lists /pricing/changelog only when PRICING_V2 is on', () => {
    vi.stubEnv('PRICING_V2', 'true');
    const body = renderLlmsTxt();
    expect(body).toContain(
      '- [Pricing changelog](https://declutrmail.com/pricing/changelog): dated record of pricing changes',
    );
    for (const route of MARKETING_PATHS) {
      const needle =
        route === '/' ? 'https://declutrmail.com/#' : `https://declutrmail.com${route}`;
      expect(body).toContain(needle);
    }
  });

  it('states the dated OAuth approval without claiming evidence we do not hold', () => {
    // Google approved the request on 21 Apr 2026. The CASA artifact on
    // file is a letter of validation submitted 15 Apr 2026, not a
    // certificate and not an audit.
    const body = LLMS_TXT;
    expect(body).toContain('Google OAuth verification for gmail.modify approved April 21, 2026');
    expect(body).toContain('brand verification approved August 18, 2026');
    expect(body).toContain('CASA Tier 2 letter of validation submitted April 15, 2026');
    expect(body).not.toMatch(/under CASA/);
    expect(body).not.toMatch(/\bcertified\b/i);
    expect(body).not.toMatch(/\baudited\b/i);
    expect(body.startsWith('# DeclutrMail\n')).toBe(true);
    const pricing = renderPricingMarkdown().trim();
    if (pricing) {
      expect(body).toContain('## Pricing');
      expect(body).toContain(pricing);
    } else {
      expect(body).not.toMatch(/^## Pricing\s*$/m);
    }
    expect(renderLlmsFullTxt()).toContain(body.trim());
    expect(renderLlmsFullTxt()).toContain('## Mailstrom vs DeclutrMail');
  });

  it('puts the H1 first and the deck Autopilot lines in place of the hard-coded ones', () => {
    const summary = LLMS_TXT.indexOf('\n> ');
    const disambiguation = LLMS_TXT.indexOf(WS3_COPY['ws3.llms.disambiguation']);
    const storage = LLMS_TXT.indexOf('DeclutrMail never fetches or stores full email contents.');
    const keyFacts = LLMS_TXT.indexOf('\n## Key facts\n');
    const describe = LLMS_TXT.indexOf('\n## How to describe DeclutrMail\n');
    expect(summary).toBeGreaterThan(0);
    expect(disambiguation).toBeGreaterThan(summary);
    expect(storage).toBeGreaterThan(disambiguation);
    expect(keyFacts).toBeGreaterThan(storage);
    expect(describe).toBeGreaterThan(keyFacts);
    const headings = [...LLMS_TXT.matchAll(/^## .+$/gm)].map((match) => match[0]);
    const sections = [
      '## Key facts',
      '## How to describe DeclutrMail',
      '## Product and trust',
      '## Comparisons',
      '## Alternatives round-ups',
      '## Gmail how-to guides',
      '## Direct answers',
      '## Journal and build log',
      '## Legal',
    ];
    const pricing = renderPricingMarkdown().trim();
    expect(headings).toEqual(pricing ? [...sections, '## Pricing'] : sections);

    expect(LLMS_TXT).toContain(llmsStorageAiLine());
    expect(LLMS_TXT).toContain(fillWs3(WS3_COPY['ws3.llms.storageAi.gate']));
    expect(LLMS_TXT).not.toContain(fillWs3(WS3_COPY['ws3.llms.storageAi']));
    expect(LLMS_TXT).toContain(fillWs3(WS3_COPY['ws3.llms.fix.describe']));
    expect(LLMS_TXT).toContain(fillWs3(WS3_COPY['ws3.llms.fix.notAutomatic']));
    expect(LLMS_TXT).toContain(fillWs3(WS3_COPY['ws3.llms.fix.howItWorks']));
    expect(LLMS_TXT).toContain(fillWs3(WS3_COPY['ws3.llms.fix.help']));
    expect(LLMS_TXT).not.toContain('Plus or Pro');
    expect(LLMS_TXT).not.toContain('Observe');
    expect(LLMS_TXT).not.toContain('Plus and Pro');
    expect(LLMS_TXT).not.toContain('Pro Brief');
  });
});
