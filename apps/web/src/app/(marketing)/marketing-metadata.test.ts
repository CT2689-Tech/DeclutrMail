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
import { metadata as beta } from './beta/page';
import { metadata as pricing } from './pricing/page';
import { metadata as privacy } from './privacy/page';
import { metadata as terms } from './terms/page';
import { metadata as refunds } from './refunds/page';
import { metadata as cookies } from './cookies/page';
import { metadata as help } from './help/page';
import { metadata as methodology } from './methodology/page';
import { metadata as changelog } from './changelog/page';
import { metadata as compare } from './compare/page';
import { metadata as blog } from './blog/page';
import { metadata as inboxSimulator } from './inbox-simulator/page';
import { metadata as contact } from './contact/page';
import { metadata as security } from './security/page';
import { metadata as vsCleanEmail } from './vs/clean-email/page';
import { metadata as howToClean } from './how-to/clean-gmail-by-sender/page';
import { metadata as answerSafe } from './answers/is-it-safe-to-connect-gmail-app/page';

const PAGES: ReadonlyArray<{ name: string; metadata: Metadata; path: string }> = [
  { name: 'landing', metadata: landing, path: '/' },
  { name: 'beta', metadata: beta, path: '/beta' },
  { name: 'pricing', metadata: pricing, path: '/pricing' },
  { name: 'privacy', metadata: privacy, path: '/privacy' },
  { name: 'terms', metadata: terms, path: '/terms' },
  { name: 'refunds', metadata: refunds, path: '/refunds' },
  { name: 'cookies', metadata: cookies, path: '/cookies' },
  { name: 'help', metadata: help, path: '/help' },
  { name: 'methodology', metadata: methodology, path: '/methodology' },
  { name: 'changelog', metadata: changelog, path: '/changelog' },
  { name: 'compare', metadata: compare, path: '/compare' },
  { name: 'blog', metadata: blog, path: '/blog' },
  { name: 'inbox-simulator', metadata: inboxSimulator, path: '/inbox-simulator' },
  { name: 'contact', metadata: contact, path: '/contact' },
  { name: 'security', metadata: security, path: '/security' },
  { name: 'vs-clean-email', metadata: vsCleanEmail, path: '/vs/clean-email' },
  { name: 'how-to-clean-by-sender', metadata: howToClean, path: '/how-to/clean-gmail-by-sender' },
  {
    name: 'answers-safe-connect',
    metadata: answerSafe,
    path: '/answers/is-it-safe-to-connect-gmail-app',
  },
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

  it('pins og:image + twitter:image (shallow-merge trap)', () => {
    const og = metadata.openGraph as { images?: unknown };
    const twitter = metadata.twitter as { images?: unknown };
    expect(og.images).toBeTruthy();
    expect(twitter.images).toBeTruthy();
  });
});
