// robots.txt (D134 public-route split).
//
// Crawlers get the public marketing surface and nothing else: every
// authed app route (the `(app)` group) plus `/onboarding` is
// disallowed — those URLs 401-bounce to OAuth anyway, so indexing
// them would only surface login redirects in search results.
//
// Route groups don't appear in URLs, so the disallow list enumerates
// the real top-level paths under `apps/web/src/app/(app)/` plus
// `/onboarding`. When a new authed route group folder is added, add
// its path here.

import type { MetadataRoute } from 'next';

import { siteUrl } from '@/features/marketing/landing/urls';

/** Top-level authed paths — mirrors `apps/web/src/app/(app)/*` + onboarding. */
export const AUTHED_APP_PATHS = [
  '/activity',
  '/admin',
  '/autopilot',
  '/billing',
  '/brief',
  '/followups',
  '/onboarding',
  '/quiet',
  '/screener',
  '/senders',
  '/settings',
  '/snoozed',
  '/triage',
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // robots.txt disallow is prefix-based, so `/senders` also
        // covers `/senders/<id>` and deeper paths.
        disallow: [...AUTHED_APP_PATHS],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
