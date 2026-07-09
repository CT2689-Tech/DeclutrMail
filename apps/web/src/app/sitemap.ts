// sitemap.xml (D134 SEO).
//
// Public marketing surface only — authed app routes are disallowed in
// robots.ts and must never appear here. `/pricing`, `/privacy`,
// `/terms`, `/refunds` ship in sibling launch units; listing them
// before merge is intentional (the sitemap describes the launch
// surface, and crawlers tolerate brief 404s far better than a stale
// sitemap tolerates missing pages).

import type { MetadataRoute } from 'next';

import { siteUrl } from '@/features/marketing/landing/urls';

/** Public marketing paths, in crawl-priority order. */
export const MARKETING_PATHS = [
  '/',
  '/pricing',
  '/beta',
  '/help',
  '/methodology',
  '/changelog',
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
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.6,
  }));
}
