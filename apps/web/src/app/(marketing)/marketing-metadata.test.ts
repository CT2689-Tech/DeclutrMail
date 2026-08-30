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

import { existsSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { Metadata } from 'next';

import { ACTION_SEMANTICS } from '@declutrmail/shared/actions';

import { metadata as landing } from './page';
import { metadata as beta } from './beta/page';
import { metadata as pricing } from './pricing/page';
import { metadata as privacy } from './privacy/page';
import { metadata as terms } from './terms/page';
import { metadata as refunds } from './refunds/page';
import { metadata as cookies } from './cookies/page';
import { metadata as help } from './help/page';
import { metadata as contact } from './contact/page';
import { metadata as security } from './security/page';
import { metadata as blog } from './blog/page';
import { metadata as howToHub } from './how-to/page';
import { metadata as answersHub } from './answers/page';
import { metadata as faq } from './faq/page';
import { metadata as changelog } from './changelog/page';
import { metadata as howItWorks } from './how-it-works/page';
import { metadata as compare } from './compare/page';
import { metadata as methodology } from './methodology/page';
import { metadata as inboxSimulator } from './inbox-simulator/page';
import { alt as simulatorCardAlt } from './inbox-simulator/opengraph-image';

const PAGES: ReadonlyArray<{
  name: string;
  metadata: Metadata;
  path: string;
  /** The page ships its own co-located card instead of the site default. */
  routeOwnCard?: boolean;
}> = [
  { name: 'landing', metadata: landing, path: '/' },
  { name: 'beta', metadata: beta, path: '/beta' },
  { name: 'pricing', metadata: pricing, path: '/pricing' },
  { name: 'privacy', metadata: privacy, path: '/privacy' },
  { name: 'terms', metadata: terms, path: '/terms' },
  { name: 'refunds', metadata: refunds, path: '/refunds' },
  { name: 'cookies', metadata: cookies, path: '/cookies' },
  { name: 'help', metadata: help, path: '/help' },
  { name: 'contact', metadata: contact, path: '/contact' },
  { name: 'security', metadata: security, path: '/security' },
  { name: 'blog', metadata: blog, path: '/blog' },
  { name: 'how-to hub', metadata: howToHub, path: '/how-to' },
  { name: 'answers hub', metadata: answersHub, path: '/answers' },
  { name: 'faq', metadata: faq, path: '/faq' },
  { name: 'changelog', metadata: changelog, path: '/changelog' },
  { name: 'how-it-works', metadata: howItWorks, path: '/how-it-works' },
  { name: 'compare', metadata: compare, path: '/compare' },
  { name: 'methodology', metadata: methodology, path: '/methodology' },
  {
    name: 'inbox-simulator',
    metadata: inboxSimulator,
    path: '/inbox-simulator',
    routeOwnCard: true,
  },
];

/**
 * D250 §3.6 row 21 prescribes this exact title. Nothing asserted it, so the
 * string was changed twice while shipping D250 before the gap was noticed.
 *
 * This pins the VALUE the spec chose — not a length policy. An earlier
 * attempt asserted a 60-character budget across every route and was
 * reverted: no D-decision or ADR establishes one, and inventing repo-wide
 * copy rules is not an agent's call (CLAUDE.md §11). The title's length is
 * a live question recorded in FOUNDER-FOLLOWUPS; if a budget is ever
 * ratified, this assertion changes with the string it guards.
 */
describe('the blog index title — D250 §3.6 row 21', () => {
  it('carries the string the spec prescribed, exactly', () => {
    // Equality, not `toContain`: a substring check passes on any superstring,
    // so an appended suffix would drift from the prescribed value unnoticed —
    // which is the failure this assertion exists to catch.
    expect(blog.title).toEqual({
      absolute: 'DeclutrMail articles — previews, undo, and the limits of bulk email',
    });
  });
});

describe('pricing points answer engines at its machine-readable twin', () => {
  it('links /pricing.md as a text/markdown alternate without moving the canonical', () => {
    expect(pricing.alternates?.canonical).toBe('/pricing');
    expect(pricing.alternates?.types).toEqual({ 'text/markdown': '/pricing.md' });
  });
});

describe('the simulator carries its own share card — playbook G7', () => {
  /**
   * The card is attached by Next's file convention, at a URL carrying a
   * build-time suffix that nothing may hardcode. So the guard is that the
   * FILE is still there: opting out of the default card and then losing the
   * co-located card would leave the most-shared link with no preview image
   * at all, and no assertion about `metadata` alone can see that.
   */
  it('keeps the co-located card file the opted-out metadata depends on', () => {
    const cardPath = nodePath.join(
      nodePath.dirname(fileURLToPath(import.meta.url)),
      'inbox-simulator',
      'opengraph-image.tsx',
    );
    expect(existsSync(cardPath)).toBe(true);
  });

  it('describes the card as the made-up preview it renders', () => {
    expect(simulatorCardAlt).toMatch(/preview/i);
    expect(simulatorCardAlt).toMatch(/made-up/i);
  });

  /**
   * The card shipped once saying only "Reversible from Activity" — the
   * shorthand that reads as unlimited undo, on the one surface that
   * travels without its page. Pinned to the shared registry rather than to
   * a literal so the card cannot drift from what Archive actually does.
   */
  it('states Archive undo as the plan window, not as unconditional', () => {
    const source = readFileSync(
      nodePath.join(
        nodePath.dirname(fileURLToPath(import.meta.url)),
        'inbox-simulator',
        'opengraph-image.tsx',
      ),
      'utf8',
    );
    const straightQuotes = (text: string) => text.replace(/[’‘]/g, "'");

    expect(straightQuotes(source)).toContain(
      straightQuotes(ACTION_SEMANTICS.archive.activityUndo.summary),
    );
    expect(source).not.toMatch(/Reversible from Activity\./);
  });
});

describe("meta description length — stays inside Google's display limit", () => {
  it('keeps /pricing and /compare descriptions at 160 characters or fewer', () => {
    expect(pricing.description!.length).toBeLessThanOrEqual(160);
    expect(compare.description!.length).toBeLessThanOrEqual(160);
  });
});

describe.each(PAGES)('$name page metadata — D132', ({ metadata, path, routeOwnCard }) => {
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
    // The exception is a page with its own co-located card: pinning would
    // 404 there, and leaving the images out is what lets Next attach it.
    const og = metadata.openGraph as { images?: Array<{ url: string }> };
    const twitter = metadata.twitter as { images?: Array<{ url: string }> };

    if (routeOwnCard) {
      expect(og.images).toBeUndefined();
      expect(twitter.images).toBeUndefined();
      return;
    }
    expect(og.images).toMatchObject([{ url: '/opengraph-image' }]);
    expect(twitter.images).toMatchObject([{ url: '/opengraph-image' }]);
  });
});
