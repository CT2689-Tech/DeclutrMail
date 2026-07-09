// sitemap.xml (D134 SEO + D132 growth IA).
//
// Public marketing surface only — authed app routes are disallowed in
// robots.ts and must never appear here. Nested /vs /how-to /answers
// routes are listed explicitly; sitemap.test.ts walks the filesystem
// recursively so a missing entry fails CI.

import type { MetadataRoute } from 'next';

import { siteUrl } from '@/features/marketing/landing/urls';
import { COMPETITORS } from '@/features/marketing/growth/vs-data';
import { HOW_TO_PAGES } from '@/features/marketing/growth/how-to-data';
import { ANSWER_PAGES } from '@/features/marketing/growth/answers-data';

/** Public marketing paths, in crawl-priority order. */
export const MARKETING_PATHS = [
  '/',
  '/pricing',
  '/beta',
  '/help',
  '/methodology',
  '/changelog',
  '/compare',
  '/inbox-simulator',
  '/blog',
  ...COMPETITORS.map((c) => c.path),
  ...HOW_TO_PAGES.map((p) => p.path),
  ...ANSWER_PAGES.map((p) => p.path),
  '/contact',
  '/security',
  '/privacy',
  '/terms',
  '/refunds',
  '/cookies',
] as const;

function priorityFor(path: (typeof MARKETING_PATHS)[number]): number {
  if (path === '/') return 1;
  if (path.startsWith('/vs/') || path.startsWith('/how-to/') || path.startsWith('/answers/')) {
    return 0.5;
  }
  return 0.6;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return MARKETING_PATHS.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: priorityFor(path),
  }));
}
