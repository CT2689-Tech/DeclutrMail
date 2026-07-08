/**
 * Per-page SEO metadata contract for the public marketing surface
 * (D132 SEO batch; D128 canonical origin).
 *
 * Every indexable marketing page must declare a canonical path plus
 * Open Graph + Twitter card fields. Values are RELATIVE here — the
 * root layout's `metadataBase` (siteUrl(), D128) resolves them to the
 * canonical origin at render time; the dev-server smoke verifies the
 * absolute form in real HTML.
 */

import { describe, expect, it } from 'vitest';
import type { Metadata } from 'next';

import { metadata as landing } from './page';
import { metadata as pricing } from './pricing/page';
import { metadata as privacy } from './privacy/page';
import { metadata as terms } from './terms/page';
import { metadata as refunds } from './refunds/page';
import { metadata as cookies } from './cookies/page';

const PAGES: ReadonlyArray<{ name: string; metadata: Metadata; path: string }> = [
  { name: 'landing', metadata: landing, path: '/' },
  { name: 'pricing', metadata: pricing, path: '/pricing' },
  { name: 'privacy', metadata: privacy, path: '/privacy' },
  { name: 'terms', metadata: terms, path: '/terms' },
  { name: 'refunds', metadata: refunds, path: '/refunds' },
  { name: 'cookies', metadata: cookies, path: '/cookies' },
];

describe.each(PAGES)('$name page metadata — D132', ({ metadata, path }) => {
  it('declares the canonical path', () => {
    expect(metadata.alternates?.canonical).toBe(path);
  });

  it('carries an Open Graph card pinned to the same URL', () => {
    const og = metadata.openGraph as Record<string, unknown>;
    expect(og.url).toBe(path);
    expect(og.siteName).toBe('DeclutrMail');
    expect(og.locale).toBe('en_US');
    expect(og.title).toBeTruthy();
    expect(og.description).toBe(metadata.description);
  });

  it('carries a Twitter summary card', () => {
    const twitter = metadata.twitter as Record<string, unknown>;
    expect(twitter.card).toBe('summary_large_image');
    expect(twitter.title).toBeTruthy();
    expect(twitter.description).toBe(metadata.description);
  });

  it('pins the default OG card image explicitly on both networks', () => {
    // A page-level `openGraph` config shallow-replaces the parent's,
    // which silently drops the file-convention og:image — so every
    // marketing page must pin it (see features/marketing/page-metadata.ts).
    const og = metadata.openGraph as { images: Array<{ url: string }> };
    const twitter = metadata.twitter as { images: Array<{ url: string }> };
    expect(og.images).toMatchObject([{ url: '/opengraph-image' }]);
    expect(twitter.images).toMatchObject([{ url: '/opengraph-image' }]);
  });
});
