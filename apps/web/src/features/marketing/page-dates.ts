/**
 * Visible "Last updated" dates for legal and support pages.
 *
 * Next.js route modules cannot export extra values, so the date lives
 * here and both the page and `sitemap.ts` read it. A page with no entry
 * gets no sitemap `lastmod` — never a build-time date.
 */
export const PAGE_LAST_UPDATED = {
  '/privacy': '2026-09-19',
  '/cookies': '2026-09-18',
  '/help': '2026-10-10',
  '/security': '2026-08-07',
  '/refunds': '2026-10-10',
  '/terms': '2026-10-10',
  '/contact': '2026-07-07',
} as const;

export type DatedMarketingPath = keyof typeof PAGE_LAST_UPDATED;
