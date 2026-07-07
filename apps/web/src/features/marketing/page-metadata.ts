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
  alt: 'DeclutrMail — Control Gmail by sender, not by email.',
} as const;

export function marketingPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: 'DeclutrMail',
      type: 'website',
      locale: 'en_US',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }],
    },
  };
}
