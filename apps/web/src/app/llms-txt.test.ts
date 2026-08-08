/**
 * llms.txt reconciliation (D132 SEO batch, AEO/GEO).
 *
 * `public/llms.txt` is a hand-curated guide for LLM crawlers, but it must
 * not drift out of sync with the actual public surface — `/cookies` was
 * missing and `/beta` was in neither llms.txt nor the sitemap. This pins
 * llms.txt to the SAME `MARKETING_PATHS` array the sitemap is built from,
 * so the three (routes → sitemap → llms.txt) reconcile through one source
 * and the next omission fails here.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MARKETING_PATHS } from './sitemap';

const LLMS_TXT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/llms.txt'),
  'utf8',
);

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
    expect(LLMS_TXT).toContain('OAuth verification approved 21 April 2026');
    expect(LLMS_TXT).not.toMatch(/CASA Tier 2 (verification|certificate|letter)/i);
  });
});
