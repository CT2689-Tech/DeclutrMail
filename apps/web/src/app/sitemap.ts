// sitemap.xml — minimal seed listing the legal routes (D146).
//
// Deliberately minimal: U07 (landing + SEO) owns the full public
// sitemap; if its version lands first this file merge-conflicts on
// purpose — resolve by keeping U07's entries and appending the legal
// routes below.

import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const LEGAL_ROUTES = ['/privacy', '/terms', '/refunds'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return LEGAL_ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: 'yearly',
  }));
}
