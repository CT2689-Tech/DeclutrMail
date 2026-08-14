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
import {
  COMPARISONS,
  COMPARISONS_VERIFIED_FLOOR_ISO,
} from '@/features/marketing/comparison/comparison-data';
import { HOW_TO_ARTICLES, HOW_TO_SLUGS } from '@/features/marketing/learn/how-to-content';

const MARKETING_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '(marketing)');

/**
 * Every route pattern the `(marketing)` route group serves, recursively
 * derived from disk. Dynamic segments remain patterns (`/vs/[competitor]`)
 * and are matched against at least one concrete sitemap URL below.
 */
function marketingRoutePatternsFromFs(
  directory = MARKETING_DIR,
  segments: readonly string[] = [],
): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const routes: string[] = [];
  if (entries.some((entry) => entry.isFile() && entry.name === 'page.tsx')) {
    routes.push(segments.length === 0 ? '/' : `/${segments.join('/')}`);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      routes.push(
        ...marketingRoutePatternsFromFs(path.join(directory, entry.name), [
          ...segments,
          entry.name,
        ]),
      );
    }
  }
  return routes.sort();
}

function matchesPattern(route: string, pattern: string): boolean {
  const routeParts = route.split('/');
  const patternParts = pattern.split('/');
  return (
    routeParts.length === patternParts.length &&
    patternParts.every((part, index) => /^\[.+\]$/.test(part) || part === routeParts[index])
  );
}

/** Sitemap output paths (root URL is the bare origin, i.e. pathname `/`). */
function sitemapPaths(): string[] {
  return sitemap()
    .map((e) => new URL(e.url).pathname)
    .sort();
}

describe('sitemap — D134', () => {
  it('recursively covers every indexable marketing route and dynamic route family', () => {
    const patterns = marketingRoutePatternsFromFs();
    const nonIndexedRedirects = ['/demo'];
    const indexablePatterns = patterns.filter((pattern) => !nonIndexedRedirects.includes(pattern));
    const routes = sitemapPaths();

    for (const pattern of indexablePatterns) {
      expect(
        routes.some((route) => matchesPattern(route, pattern)),
        `expected sitemap coverage for ${pattern}`,
      ).toBe(true);
    }
    for (const route of routes) {
      expect(
        indexablePatterns.some((pattern) => matchesPattern(route, pattern)),
        `sitemap route ${route} has no marketing page`,
      ).toBe(true);
    }
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

  describe('lastModified', () => {
    const entryFor = (pathname: string) =>
      sitemap().find((entry) => new URL(entry.url).pathname === pathname);

    it('dates a comparison page from its own verifiedIso', () => {
      const unrollMe = COMPARISONS.find((comparison) => comparison.slug === 'unroll-me');
      expect(entryFor('/vs/unroll-me')?.lastModified).toBe(unrollMe?.verifiedIso);
    });

    it('dates an article from its own updatedAt', () => {
      const slug = HOW_TO_SLUGS[0]!;
      expect(entryFor(`/how-to/${slug}`)?.lastModified).toBe(HOW_TO_ARTICLES[slug].updatedAt);
    });

    it('dates a hub from its OLDEST child, never its freshest', () => {
      const childDates = COMPARISONS.map((comparison) => comparison.verifiedIso);
      const compare = entryFor('/compare')?.lastModified;
      expect(compare).toBe(COMPARISONS_VERIFIED_FLOOR_ISO);
      // The floor is genuinely weaker than the freshest child, so this
      // assertion would fail if the hub ever started claiming the max.
      expect(compare).not.toBe(childDates.reduce((a, b) => (a > b ? a : b)));
    });

    it('omits lastModified where no attributable date exists', () => {
      // Legal and product pages carry no machine-readable freshness
      // field, so they must ship NO <lastmod> rather than a build-time
      // one — an invented date is a claim nothing can back.
      for (const pathname of ['/', '/pricing', '/security', '/privacy', '/terms']) {
        expect(entryFor(pathname)).toBeDefined();
        expect(entryFor(pathname)?.lastModified).toBeUndefined();
      }
    });
  });
});
