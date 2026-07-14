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

  it('states the in-progress CASA posture without claiming completed verification', () => {
    expect(LLMS_TXT).toContain('CASA Tier 2 assessment cycle in progress');
    expect(LLMS_TXT).not.toContain('CASA Tier 2 verification');
  });
});
