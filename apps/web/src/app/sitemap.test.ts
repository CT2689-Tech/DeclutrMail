/**
 * sitemap.xml tests (D134 SEO).
 *
 * The sitemap must cover exactly the public marketing surface and
 * never leak an authed app route (those are robots-disallowed — a
 * sitemap/robots contradiction is a crawl-budget bug).
 *
 * Coverage is checked against the `(marketing)` FILESYSTEM, not against
 * the sitemap's own source array — an assertion of the form
 * `toHaveLength(MARKETING_PATHS.length)` is tautological and is exactly
 * how `/beta` shipped as a crawlable page absent from the sitemap. A new
 * marketing route that never gets added to the sitemap now fails here.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import sitemap from './sitemap';
import robots, { AUTHED_APP_PATHS } from './robots';

const MARKETING_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '(marketing)');

/**
 * Every route the `(marketing)` route group serves, derived from disk:
 * the group's own `page.tsx` is `/`, and each immediate subdirectory
 * holding a `page.tsx` is `/<dir>`. (Route groups like `(marketing)`
 * don't appear in the URL, so the folder name maps straight to the path.)
 */
function marketingRoutesFromFs(): string[] {
  const routes: string[] = [];

  function walk(dir: string, urlPrefix: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === 'page.tsx')) {
      routes.push(urlPrefix === '' ? '/' : urlPrefix);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip Next.js private folders (_*) and route groups ((...)).
      if (entry.name.startsWith('_') || entry.name.startsWith('(')) continue;
      walk(path.join(dir, entry.name), `${urlPrefix}/${entry.name}`);
    }
  }

  walk(MARKETING_DIR, '');
  return routes.sort();
}

/** Sitemap output paths (root URL is the bare origin, i.e. pathname `/`). */
function sitemapPaths(): string[] {
  return sitemap()
    .map((e) => new URL(e.url).pathname)
    .sort();
}

describe('sitemap — D134', () => {
  it('covers exactly the (marketing) filesystem routes — no page silently omitted', () => {
    expect(sitemapPaths()).toEqual(marketingRoutesFromFs());
  });

  it('lists the root against the canonical origin with no trailing slash', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain('https://declutrmail.com');
    expect(urls).not.toContain('https://declutrmail.com/');
  });

  it('never lists a robots-disallowed authed path', () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    for (const authedPath of AUTHED_APP_PATHS) {
      expect(urls).not.toContain(authedPath);
    }
  });

  it('robots.txt points crawlers at this sitemap (D132 SEO batch)', () => {
    expect(robots().sitemap).toBe('https://declutrmail.com/sitemap.xml');
  });
});
