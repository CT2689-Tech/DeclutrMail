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

import { CASA_VERIFICATION_APPROVED_ON, formatVerificationDate } from '@declutrmail/shared';
import { ACTION_SEMANTICS } from '@declutrmail/shared/actions';
import { WS3_COPY } from '@declutrmail/shared/copy/launch';
import {
  launchPriceDisplay,
  MIN_UNDO_WINDOW_DAYS,
  minimumTierForCapability,
  storyValues,
  TIER_MANIFEST,
  UNIFORM_UNDO_WINDOW_DAYS,
} from '@declutrmail/shared/entitlements';

import { MARKETING_PATHS } from '@/app/sitemap';
import { alternativesFor, comparisonBySlug } from '@/features/marketing/comparison/comparison-data';

import { alt as defaultCardAlt, size as defaultCardSize } from '../opengraph-image';
import { metadata as landing } from './page';
import { metadata as beta } from './beta/page';
import { pricingPageMetadata } from '@/features/marketing/pricing/pricing-metadata';

/** Flag-off metadata. `generateMetadata` returns this unless PRICING_V2 is on. */
const pricing = pricingPageMetadata(false);
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
import { metadata as pricingChangelog } from './pricing/changelog/page';
import { metadata as howItWorks } from './how-it-works/page';
import { metadata as compare } from './compare/page';
import { metadata as methodology } from './methodology/page';
import { metadata as inboxSimulator } from './inbox-simulator/page';
import { alt as simulatorCardAlt } from './inbox-simulator/opengraph-image';
import { metadata as signIn } from './sign-in/page';
import { generateMetadata as comparisonMetadata } from './vs/[competitor]/page';
import { generateMetadata as alternativesMetadata } from './alternatives/[tool]/page';
import { generateMetadata as blogPostMetadata } from './blog/[slug]/page';
import { metadata as howToClean } from './how-to/clean-gmail-by-sender/page';
import { metadata as howToDelete } from './how-to/bulk-delete-emails-from-one-sender/page';
import { metadata as howToStorage } from './how-to/gmail-storage-full/page';
import { metadata as howToArchive } from './how-to/auto-archive-future-emails-in-gmail/page';
import { metadata as howToPromo } from './how-to/stop-promotional-emails-gmail/page';
import { metadata as howToUnsub } from './how-to/unsubscribe-from-emails-gmail/page';
import { metadata as answerSafe } from './answers/is-it-safe-to-connect-gmail-app/page';
import { metadata as answerMeta } from './answers/what-is-metadata-only-email-analysis/page';
import { metadata as answerUndo } from './answers/how-undo-works-for-gmail-cleanup/page';
import { metadata as answerBest } from './answers/best-way-to-clean-gmail-2026/page';
import { metadata as answerSender } from './answers/sender-level-vs-message-level-cleanup/page';

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
 * Titles and descriptions are copy (CLAUDE.md §2.0, Tier 2): these tests pin
 * the facts inside them — prices, allowances and undo days from the pricing
 * manifest, tier names, privacy and verification wording — never the
 * sentence around them.
 */
describe('pricing metadata follows the launch flag', () => {
  it('quotes the manifest prices, allowance and undo window, and names the pass only when it is on', () => {
    expect(pricingPageMetadata(false).description).toBe(pricing.description);
    const passOff = pricingPageMetadata(true, false);
    const passOn = pricingPageMetadata(true, true);
    const story = storyValues('usd');
    // "on every plan" is only true while every tier grants the same window.
    expect(UNIFORM_UNDO_WINDOW_DAYS).not.toBeNull();
    for (const meta of [passOff, passOn]) {
      const description = String(meta.description);
      for (const fact of [
        `${story.freeName} is ${launchPriceDisplay('usd').free.amount}`,
        `${story.allowance} emails`,
        `${story.plusName} is ${story.plusPrice} a year`,
        `${UNIFORM_UNDO_WINDOW_DAYS}-day Undo on every plan`,
      ]) {
        expect(description).toContain(fact);
      }
      expect(meta.openGraph).toMatchObject({ description });
      expect(meta.twitter).toMatchObject({ description });
    }
    expect(passOn.description).toContain(`${story.passName} is ${story.passPrice} once`);
    expect(passOff.description).not.toContain(String(story.passName));
    expect(pricingPageMetadata(true, true).alternates?.canonical).toBe('/pricing');
  });

  it('attributes each feature it names to the tier that first unlocks it', () => {
    const description = String(pricing.description);
    for (const id of ['free', 'plus', 'pro'] as const) {
      expect(description).toContain(TIER_MANIFEST[id].name);
    }
    const sentences = description.split(/(?<=\.)\s+/);
    for (const [label, capability] of [
      ['Screener', 'screener'],
      ['Autopilot', 'autopilot'],
      ['Quiet hours', 'quiet'],
      ['Daily Brief', 'brief'],
      ['Follow-ups', 'followups'],
    ] as const) {
      const sentence = sentences.find((candidate) => candidate.includes(label));
      if (sentence === undefined) continue; // Not named, so nothing to attribute.
      expect(sentence, label).toContain(TIER_MANIFEST[minimumTierForCapability(capability)].name);
    }
  });
});

describe('pricing points answer engines at its machine-readable twin', () => {
  it('links /pricing.md as a text/markdown alternate without moving the canonical', () => {
    expect(pricing.alternates?.canonical).toBe('/pricing');
    expect(pricing.alternates?.types).toEqual({ 'text/markdown': '/pricing.md' });
  });
});

describe('historical changelog visibility', () => {
  it('keeps the incomplete archive out of search results until release notes catch up', () => {
    expect(changelog.robots).toEqual({ index: false, follow: true });
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

describe('meta description length — stays inside Google’s display limit', () => {
  it('keeps /pricing and /compare descriptions at 160 characters or fewer', () => {
    expect(pricing.description!.length).toBeLessThanOrEqual(160);
    expect(compare.description!.length).toBeLessThanOrEqual(160);
  });
});

const STATIC_METADATA = new Map<string, Metadata>([
  ...PAGES.map((page) => [page.path, page.metadata] as const),
  ['/sign-in', signIn],
  ['/pricing/changelog', pricingChangelog],
  ['/how-to/clean-gmail-by-sender', howToClean],
  ['/how-to/bulk-delete-emails-from-one-sender', howToDelete],
  ['/how-to/gmail-storage-full', howToStorage],
  ['/how-to/auto-archive-future-emails-in-gmail', howToArchive],
  ['/how-to/stop-promotional-emails-gmail', howToPromo],
  ['/how-to/unsubscribe-from-emails-gmail', howToUnsub],
  ['/answers/is-it-safe-to-connect-gmail-app', answerSafe],
  ['/answers/what-is-metadata-only-email-analysis', answerMeta],
  ['/answers/how-undo-works-for-gmail-cleanup', answerUndo],
  ['/answers/best-way-to-clean-gmail-2026', answerBest],
  ['/answers/sender-level-vs-message-level-cleanup', answerSender],
]);

function titleText(metadata: Metadata): string {
  const title = metadata.title;
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object' && 'absolute' in title && title.absolute) {
    return title.absolute;
  }
  return '';
}

async function metadataForPath(path: string): Promise<Metadata> {
  if (path.startsWith('/vs/')) {
    return comparisonMetadata({
      params: Promise.resolve({ competitor: path.slice('/vs/'.length) }),
    });
  }
  if (path.startsWith('/alternatives/')) {
    return alternativesMetadata({
      params: Promise.resolve({ tool: path.slice('/alternatives/'.length) }),
    });
  }
  if (path.startsWith('/blog/') && path !== '/blog') {
    return blogPostMetadata({ params: Promise.resolve({ slug: path.slice('/blog/'.length) }) });
  }
  const metadata = STATIC_METADATA.get(path);
  if (!metadata) throw new Error(`no metadata fixture for ${path}`);
  return metadata;
}

const FORBIDDEN_WORDING = /Declutr Mail|DeclutterMail|metadata only|never reads/i;

const APPROVED_OVER_LIMIT = new Map<string, string>([
  ['/inbox-simulator', WS3_COPY['ws3.pr1019.simulator.description']],
  ['/blog/reversible-does-not-mean-risk-free', WS3_COPY['ws3.pr1019.blog.recovery.description']],
]);

describe('marketing metadata guards', () => {
  it('gives every sitemap path a self canonical and a description of at most 160 characters', async () => {
    for (const path of MARKETING_PATHS) {
      const metadata = await metadataForPath(path);
      const description = metadata.description ?? '';
      expect(metadata.alternates?.canonical, path).toBe(path);
      // drop2-r32 locked these two descriptions past Google's 160-character
      // display cap. Pin the deck string so any other page still fails at 160.
      const approvedOverLimit = APPROVED_OVER_LIMIT.get(path);
      if (approvedOverLimit) {
        expect(description, path).toBe(approvedOverLimit);
      } else {
        expect(description.length, `${path} (${description.length})`).toBeLessThanOrEqual(160);
      }
      expect(titleText(metadata), path).not.toMatch(FORBIDDEN_WORDING);
      expect(description, path).not.toMatch(FORBIDDEN_WORDING);
    }
  });

  it('gives every sitemap path a branded title and a title and description no other page reuses', async () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const path of MARKETING_PATHS) {
      const metadata = await metadataForPath(path);
      const title = titleText(metadata);
      const description = metadata.description ?? '';
      expect(title, path).toContain('DeclutrMail');
      expect(description.trim(), path).not.toBe('');
      expect(titles.get(title), `${path} reuses the title of`).toBeUndefined();
      expect(descriptions.get(description), `${path} reuses the description of`).toBeUndefined();
      titles.set(title, path);
      descriptions.set(description, path);
    }
    expect(titles.size).toBe(MARKETING_PATHS.length);
  });

  it('keeps /sign-in followable but out of the index', () => {
    expect(signIn.robots).toEqual({ index: false, follow: true });
    expect(signIn.alternates?.canonical).toBe('/sign-in');
  });

  it('noindexes pricing history and retired beta while keeping links followable', () => {
    expect(pricingChangelog.robots).toEqual({ index: false, follow: true });
    expect(beta.robots).toEqual({ index: false, follow: true });
  });

  it('keeps the facts the comparison and alternatives descriptions state', async () => {
    const unroll = await metadataForPath('/vs/unroll-me');
    expect(titleText(unroll)).toContain('Unroll.Me');
    expect(unroll.description).toContain('never fetches or stores full email contents');
    expect(unroll.description).toContain('market research');

    const muse = await metadataForPath('/vs/meta-muse');
    expect(titleText(muse)).toContain('Meta Muse');
    expect(muse.description).toContain('never fetches full message contents');
    expect(muse.description).toContain('can read and send mail');

    const alternatives = MARKETING_PATHS.filter((path) => path.startsWith('/alternatives/'));
    expect(alternatives.length).toBeGreaterThan(0);
    for (const path of alternatives) {
      const subject = alternativesFor(path.slice('/alternatives/'.length))?.subject.name;
      const metadata = await metadataForPath(path);
      expect(subject, path).toBeTruthy();
      expect(titleText(metadata), path).toContain(subject!);
      // A live public statement; the badge under the page title says it too.
      expect(metadata.description, path).toContain('No rankings, no affiliates.');
    }

    // Facts, not the sentence: made-up data, the verbs it previews, no access.
    expect(inboxSimulator.description).toContain('made-up email');
    expect(inboxSimulator.description).toContain('Archive, Later or Delete');
    expect(inboxSimulator.description).toContain('No signup or Gmail access needed');
    expect((inboxSimulator.description ?? '').length).toBeLessThanOrEqual(160);
    expect(cookies.description).toContain('PostHog analytics runs only with your consent');
    expect(privacy.description).toContain('We do not sell Gmail data or use it for advertising.');
  });

  it('keeps the privacy and business-model facts on the visible comparison descriptions', () => {
    expect(comparisonBySlug('unroll-me')?.description).toContain('market-research business model');
    expect(comparisonBySlug('meta-muse')?.description).toContain(
      'never fetches full message contents',
    );
  });

  it('keeps the facts the page descriptions state', () => {
    expect(landing.description).toContain(
      `${MIN_UNDO_WINDOW_DAYS}-day undo on Archive, Later, and Delete`,
    );
    expect(security.description).toContain('never fetches or stores full email contents');
    expect(security.description).toContain('encrypts Google access tokens');
    // Google approved a verification; it did not certify or audit anything.
    expect(security.description).toContain(
      `verification approved ${formatVerificationDate(CASA_VERIFICATION_APPROVED_ON)}`,
    );
    expect(security.description).not.toMatch(/certif|audit/i);
    expect(compare.description).toContain('unknowns left unknown');
  });
});

describe('homepage share card — Content deck drop2-r54 share.home', () => {
  it('gives the share card one social title on both networks', () => {
    const socialTitle = (landing.openGraph as { title?: unknown }).title;
    expect(typeof socialTitle === 'string' && socialTitle.trim()).toBeTruthy();
    expect(landing.twitter).toMatchObject({ title: socialTitle });
  });

  it('draws the social title on the card image, describes it in the alt, and declares one card', () => {
    expect(defaultCardSize).toEqual({ width: 1200, height: 630 });
    expect(landing.openGraph).toMatchObject({
      images: [{ url: '/opengraph-image', ...defaultCardSize, alt: defaultCardAlt }],
    });
    expect(landing.twitter).toMatchObject({
      images: [{ url: '/opengraph-image', alt: defaultCardAlt }],
    });

    const source = readFileSync(
      nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '../opengraph-image.tsx'),
      'utf8',
    );
    const socialTitle = String((landing.openGraph as { title?: unknown }).title);
    const sentences = socialTitle.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(source).toContain(`>${sentence}</span>`);
      expect(defaultCardAlt).toContain(sentence);
    }
    expect(defaultCardAlt).toContain('DeclutrMail');
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
