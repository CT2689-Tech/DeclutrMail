/**
 * sitemap.xml tests (D134 SEO).
 *
 * The sitemap must cover exactly the public marketing surface and
 * never leak an authed app route (those are robots-disallowed — a
 * sitemap/robots contradiction is a crawl-budget bug).
 */

import { describe, expect, it } from 'vitest';

import sitemap, { MARKETING_PATHS } from './sitemap';
import { AUTHED_APP_PATHS } from './robots';

describe('sitemap — D134', () => {
  it('lists every marketing route against the canonical origin', () => {
    const entries = sitemap();
    expect(entries).toHaveLength(MARKETING_PATHS.length);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://declutrmail.com');
    expect(urls).toContain('https://declutrmail.com/pricing');
    expect(urls).toContain('https://declutrmail.com/privacy');
    expect(urls).toContain('https://declutrmail.com/terms');
    expect(urls).toContain('https://declutrmail.com/refunds');
  });

  it('never lists a robots-disallowed authed path', () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    for (const authedPath of AUTHED_APP_PATHS) {
      expect(urls).not.toContain(authedPath);
    }
  });
});
