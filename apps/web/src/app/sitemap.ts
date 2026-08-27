// sitemap.xml (D134 SEO).
//
// Public marketing surface only — authed app routes are disallowed in
// robots.ts and must never appear here. The recursive sitemap test keeps
// this list aligned with every indexable route in the marketing group.

import type { MetadataRoute } from 'next';

import {
  ALTERNATIVES_SLUGS,
  alternativesFor,
  COMPARISONS,
  COMPARISONS_VERIFIED_FLOOR_ISO,
} from '@/features/marketing/comparison/comparison-data';
import { siteUrl } from '@/features/marketing/landing/urls';
import { ANSWER_ARTICLES, ANSWER_SLUGS } from '@/features/marketing/learn/answer-content';
import { BLOG_ARTICLES, BLOG_SLUGS } from '@/features/marketing/learn/blog-content';
import { CHANGELOG_ENTRIES } from '@/features/marketing/learn/changelog-content';
import { HOW_TO_ARTICLES, HOW_TO_SLUGS } from '@/features/marketing/learn/how-to-content';

/** Public marketing paths, in crawl-priority order. */
export const MARKETING_PATHS = [
  '/',
  '/how-it-works',
  '/inbox-simulator',
  '/methodology',
  '/pricing',
  '/sign-in',
  '/beta',
  '/compare',
  ...COMPARISONS.map((comparison) => `/vs/${comparison.slug}` as const),
  ...ALTERNATIVES_SLUGS.map((slug) => `/alternatives/${slug}` as const),
  '/how-to',
  ...HOW_TO_SLUGS.map((slug) => `/how-to/${slug}` as const),
  '/answers',
  ...ANSWER_SLUGS.map((slug) => `/answers/${slug}` as const),
  '/blog',
  ...BLOG_SLUGS.map((slug) => `/blog/${slug}` as const),
  '/changelog',
  '/faq',
  '/help',
  '/contact',
  '/security',
  '/privacy',
  '/terms',
  '/refunds',
  '/cookies',
] as const;

/** The weakest (oldest) date in a set — never the freshest. */
function oldest(dates: readonly string[]): string {
  return dates.reduce((min, date) => (date < min ? date : min));
}

/**
 * `<lastmod>` per path, emitted ONLY where an attributable date already
 * exists in content.
 *
 * Article `updatedAt` and comparison `verifiedIso` are public freshness
 * claims (see `learn/types.ts` — "must be attributable, not
 * aspirational"), so a page with no such date gets NO `lastModified`
 * rather than today's. A `<lastmod>` derived from build time would be a
 * freshness claim nothing can back, which is worse than omitting it.
 *
 * Hubs claim the OLDEST of their children, matching the rule
 * `COMPARISONS_VERIFIED_FLOOR_ISO` already sets for `/compare`: a hub
 * covers every child at once, so it is only as fresh as its weakest.
 * `/changelog` is the exception — it genuinely changes when its newest
 * entry lands, and `CHANGELOG_ENTRIES` is newest-first.
 */
const LAST_MODIFIED = new Map<string, string>([
  ...COMPARISONS.map((comparison) => [`/vs/${comparison.slug}`, comparison.verifiedIso] as const),
  // An alternatives page shows every tool at once, so like `/compare` it
  // is only as fresh as the oldest page it draws from — `alternativesFor`
  // already computes that floor.
  ...ALTERNATIVES_SLUGS.map(
    (slug) => [`/alternatives/${slug}`, alternativesFor(slug)?.verifiedIso ?? ''] as const,
  ).filter(([, iso]) => iso !== ''),
  ...HOW_TO_SLUGS.map((slug) => [`/how-to/${slug}`, HOW_TO_ARTICLES[slug].updatedAt] as const),
  ...ANSWER_SLUGS.map((slug) => [`/answers/${slug}`, ANSWER_ARTICLES[slug].updatedAt] as const),
  ...BLOG_SLUGS.map((slug) => [`/blog/${slug}`, BLOG_ARTICLES[slug].updatedAt] as const),
  ['/compare', COMPARISONS_VERIFIED_FLOOR_ISO],
  ['/how-to', oldest(HOW_TO_SLUGS.map((slug) => HOW_TO_ARTICLES[slug].updatedAt))],
  ['/answers', oldest(ANSWER_SLUGS.map((slug) => ANSWER_ARTICLES[slug].updatedAt))],
  ['/blog', oldest(BLOG_SLUGS.map((slug) => BLOG_ARTICLES[slug].updatedAt))],
  ...CHANGELOG_ENTRIES.slice(0, 1).map((entry) => ['/changelog', entry.date] as const),
]);

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return MARKETING_PATHS.map((path) => {
    const lastModified = LAST_MODIFIED.get(path);
    return {
      url: `${base}${path === '/' ? '' : path}`,
      ...(lastModified === undefined ? {} : { lastModified }),
      changeFrequency: path === '/' || path === '/changelog' ? 'weekly' : 'monthly',
      priority:
        path === '/'
          ? 1
          : [
                '/how-it-works',
                '/inbox-simulator',
                '/methodology',
                '/pricing',
                '/compare',
                '/how-to',
                '/answers',
              ].includes(path)
            ? 0.8
            : 0.6,
    };
  });
}
