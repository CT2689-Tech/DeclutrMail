// sitemap.xml (D134 SEO).
//
// Public marketing surface only — authed app routes are disallowed in
// robots.ts and must never appear here. The recursive sitemap test keeps
// this list aligned with every indexable route in the marketing group.

import type { MetadataRoute } from 'next';

import { COMPARISONS } from '@/features/marketing/comparison/comparison-data';
import { siteUrl } from '@/features/marketing/landing/urls';
import { ANSWER_SLUGS } from '@/features/marketing/learn/answer-content';
import { BLOG_SLUGS } from '@/features/marketing/learn/blog-content';
import { HOW_TO_SLUGS } from '@/features/marketing/learn/how-to-content';

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
  ...HOW_TO_SLUGS.map((slug) => `/how-to/${slug}` as const),
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

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return MARKETING_PATHS.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    changeFrequency: path === '/' || path === '/changelog' ? 'weekly' : 'monthly',
    priority:
      path === '/'
        ? 1
        : ['/how-it-works', '/inbox-simulator', '/methodology', '/pricing', '/compare'].includes(
              path,
            )
          ? 0.8
          : 0.6,
  }));
}
