/**
 * `/pricing.md` — the pricing page as Markdown, for answer engines.
 *
 * Why this exists: pricing is the fact LLMs get wrong most often about a
 * SaaS, because they read it out of a rendered table, a stale review site,
 * or a screenshot. This serves the same numbers as plain text so there is
 * nothing to misparse, and it is rendered by `renderPricingMarkdown()` —
 * the same deck copy and pricing config that render `/pricing` — so
 * published base prices stay aligned. The final checkout quote is authoritative.
 *
 * It is deliberately NOT in the sitemap: it is an alternate representation
 * of `/pricing`, not a second indexable page. Discovery is through
 * `llms.txt` and the `text/markdown` alternate on `/pricing`.
 */

import { renderPricingMarkdown } from '@declutrmail/shared/entitlements';

import { siteUrl } from '@/features/marketing/landing/urls';

export function GET() {
  const origin = siteUrl();
  return new Response(renderPricingMarkdown(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'X-Robots-Tag': 'noindex, follow',
      Link: `<${origin}/pricing>; rel="canonical"`,
    },
  });
}
