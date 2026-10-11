/**
 * llms.txt reconciliation (D132 SEO batch, AEO/GEO).
 *
 * `/llms.txt` is a generated guide for LLM crawlers, but it must
 * not drift out of sync with the actual public surface — `/cookies` was
 * missing and `/beta` was in neither llms.txt nor the sitemap. This pins
 * llms.txt to the SAME `MARKETING_PATHS` array the sitemap is built from,
 * so the three (routes → sitemap → llms.txt) reconcile through one source
 * and the next omission fails here.
 */

import { describe, expect, it } from 'vitest';

import { planName, renderPricingMarkdown } from '@declutrmail/shared/entitlements';
import { WS3_COPY } from '@declutrmail/shared/copy/launch';

import { renderLlmsFullTxt, renderLlmsTxt } from '@/features/marketing/llms/llms-document';

import { MARKETING_PATHS } from './sitemap';

const LLMS_TXT = renderLlmsTxt();

describe('llms.txt — marketing surface reconciliation', () => {
  it.each(MARKETING_PATHS)('references the public marketing route %s', (route) => {
    // The homepage is linked via its in-page anchor (/#how-it-works);
    // every other route by its absolute canonical URL.
    const needle = route === '/' ? 'https://declutrmail.com/#' : `https://declutrmail.com${route}`;
    expect(LLMS_TXT).toContain(needle);
  });

  it('states the dated OAuth approval without claiming evidence we do not hold', () => {
    // Was "assessment cycle in progress" — deliberately understated while
    // only the 15 Apr submission was on file. Google approved the request
    // on 21 Apr 2026 (FOUNDER-FOLLOWUPS 2026-07-26), so understating it is
    // now its own inaccuracy. The guard stays pointed the same way: name
    // the dated approval, never imply a certificate or letter, because the
    // artifact is an approval email and nothing else.
    expect(LLMS_TXT).toContain(
      'Google OAuth verification for gmail.modify approved April 21, 2026',
    );
    expect(LLMS_TXT).toContain('brand verification approved August 18, 2026');
    expect(LLMS_TXT).toContain('CASA Tier 2 letter of validation submitted April 15, 2026');
    expect(LLMS_TXT).not.toMatch(/under CASA/);
    expect(LLMS_TXT).not.toMatch(/\bcertified\b/i);
    expect(LLMS_TXT).not.toMatch(/\baudited\b/i);
    expect(LLMS_TXT.startsWith('# DeclutrMail\n')).toBe(true);
    const pricing = renderPricingMarkdown().trim();
    if (pricing) {
      expect(LLMS_TXT).toContain('## Pricing');
      expect(LLMS_TXT).toContain(pricing);
    } else {
      expect(LLMS_TXT).not.toMatch(/^## Pricing\s*$/m);
    }
    expect(renderLlmsFullTxt()).toContain(LLMS_TXT.trim());
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
    expect(headings[0]).toBe('## Key facts');
    const pricingAt = headings.indexOf('## Pricing');
    if (pricingAt !== -1) expect(pricingAt).toBe(headings.length - 1);

    const plus = planName('plus');
    const free = planName('free');
    expect(plus).not.toBe('');
    expect(free).not.toBe('');
    expect(LLMS_TXT).toContain(`opt into ongoing Autopilot rules on ${plus}.`);
    expect(LLMS_TXT).toContain(
      `On ${plus}, Autopilot rules set to Watch first collect matches for your approval`,
    );
    expect(LLMS_TXT).toContain(
      `Autopilot rules (${plus}) handle future matches, and act without asking only after you deliberately set a rule to Act now`,
    );
    expect(LLMS_TXT).toContain(`metered monthly on ${free}`);
    expect(LLMS_TXT).toContain('Autopilot Watch first vs Act now');
    expect(LLMS_TXT).not.toContain('Plus or Pro');
    expect(LLMS_TXT).not.toContain('Observe');
    expect(LLMS_TXT).not.toContain('Plus and Pro');
  });
});
