import type { Metadata } from 'next';

/**
 * Shared SEO metadata for public marketing pages (D132 SEO batch; D128
 * canonical origin). Relative URLs resolve against the root layout's
 * `metadataBase`.
 *
 * Why images are pinned explicitly: `app/opengraph-image.tsx`
 * auto-attaches the default OG card ONLY to routes that never define
 * `openGraph` — Next's metadata merge shallow-REPLACES the whole
 * parent object, so a page declaring its own og title silently drops
 * og:image / twitter:image (caught in the 2026-07-07 prod-build
 * smoke). Every marketing page therefore builds its metadata through
 * this helper instead of hand-rolling the block.
 */

/** The default OG card (app/opengraph-image.tsx) — route + its exported alt/size. */
const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'DeclutrMail — Clear thousands of emails by sender — and see exactly what moves.',
} as const;

export function marketingPageMetadata({
  title,
  description,
  path,
  markdownAlternate,
  routeOwnCard = false,
}: {
  title: string;
  description: string;
  path: string;
  /**
   * Set when the route has its own co-located `opengraph-image.tsx`.
   *
   * That file's URL is NOT `/<route>/opengraph-image`: Next appends a
   * build-time suffix and a cache-busting query
   * (`/inbox-simulator/opengraph-image-13uu0c?083db155e168ad19`), so a
   * hand-pinned path 404s — verified 2026-08-13. What Next does do is
   * attach the co-located card to og:image AND twitter:image by itself,
   * for this segment only, even though this helper declares `openGraph`.
   * So the correct move is to omit the images here and let the file
   * convention win. The default card still has to be pinned for every
   * other page, because the ROOT card is only auto-attached to routes
   * that declare no `openGraph` at all.
   */
  routeOwnCard?: boolean;
  /**
   * A plain-text representation of this page for answer engines, linked as
   * `<link rel="alternate" type="text/markdown">`. Discovery only — the
   * HTML page stays canonical, and the alternate is not indexed separately.
   */
  markdownAlternate?: string;
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: path,
      ...(markdownAlternate ? { types: { 'text/markdown': markdownAlternate } } : {}),
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: 'DeclutrMail',
      type: 'website',
      locale: 'en_US',
      ...(routeOwnCard ? {} : { images: [OG_IMAGE] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(routeOwnCard ? {} : { images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }] }),
    },
  };
}
