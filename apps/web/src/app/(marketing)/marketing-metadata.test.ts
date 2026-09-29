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

import { MARKETING_PATHS } from '@/app/sitemap';
import { comparisonBySlug } from '@/features/marketing/comparison/comparison-data';

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

describe("meta description length — stays inside Google's display limit", () => {
  it('keeps /pricing and /compare descriptions at 160 characters or fewer', () => {
    expect(pricing.description!.length).toBeLessThanOrEqual(160);
    expect(compare.description!.length).toBeLessThanOrEqual(160);
  });
});

const STATIC_METADATA = new Map<string, Metadata>([
  ...PAGES.map((page) => [page.path, page.metadata] as const),
  ['/sign-in', signIn],
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

describe('marketing metadata guards', () => {
  it('gives every sitemap path a self canonical and a description of at most 160 characters', async () => {
    for (const path of MARKETING_PATHS) {
      const metadata = await metadataForPath(path);
      const description = metadata.description ?? '';
      expect(metadata.alternates?.canonical, path).toBe(path);
      expect(description.length, `${path} (${description.length})`).toBeLessThanOrEqual(160);
      expect(titleText(metadata), path).not.toMatch(FORBIDDEN_WORDING);
      expect(description, path).not.toMatch(FORBIDDEN_WORDING);
    }
  });

  it('keeps /sign-in followable but out of the index', () => {
    expect(signIn.robots).toEqual({ index: false, follow: true });
    expect(signIn.alternates?.canonical).toBe('/sign-in');
  });

  it('uses the approved title and description for the twelve change rows', async () => {
    const unroll = await metadataForPath('/vs/unroll-me');
    expect(titleText(unroll)).toBe('DeclutrMail vs Unroll.Me: how each uses your email data');
    expect(unroll.description).toBe(
      'A source-backed comparison: Unroll.Me is free and uses email data for market research; DeclutrMail never fetches or stores full email contents.',
    );

    const gmail = await metadataForPath('/vs/gmail');
    expect(titleText(gmail)).toBe(
      "DeclutrMail vs Gmail's built-in cleanup — honest 2026 comparison",
    );
    expect(gmail.description).toBe(
      "A source-backed comparison of DeclutrMail and Gmail's cleanup tools (Manage subscriptions, bulk search, unsubscribe): preview, recovery and control by sender.",
    );

    const muse = await metadataForPath('/vs/meta-muse');
    expect(titleText(muse)).toBe('DeclutrMail vs Meta Muse — honest 2026 comparison');
    expect(muse.description).toBe(
      'Source-backed: DeclutrMail, a narrow Gmail cleanup tool that never fetches full message contents, vs Meta Muse, a general AI agent that can read and send mail.',
    );

    for (const [path, name] of [
      ['/alternatives/unroll-me', 'Unroll.Me'],
      ['/alternatives/clean-email', 'Clean Email'],
      ['/alternatives/sanebox', 'SaneBox'],
      ['/alternatives/leave-me-alone', 'Leave Me Alone'],
      ['/alternatives/trimbox', 'Trimbox'],
    ] as const) {
      const metadata = await metadataForPath(path);
      expect(titleText(metadata)).toBe(`${name} alternatives, compared honestly`);
      expect(metadata.description).toBe(
        `Source-backed alternatives to ${name}: what each tool is for, when to stay with ${name}, and where DeclutrMail fits. No rankings, no affiliates.`,
      );
    }

    expect(inboxSimulator.description).toBe(
      'Try Senders and Triage in a made-up inbox. Open the sender inspector, filter and select senders, and preview cleanup actions. No signup or Gmail access needed.',
    );
    expect(howToHub.description).toBe(
      'Step-by-step Gmail guides: delete all emails from one sender, free up storage when Gmail is full, auto archive future email, stop promotional email, and more.',
    );
    expect(cookies.description).toBe(
      'Change your cookie preferences at any time. Essential cookies for sign-in and billing are always on; optional PostHog analytics runs only with your consent.',
    );
    expect(privacy.description).toBe(
      'What DeclutrMail stores from Gmail, what it never fetches, processors, retention, deletion and your rights. We do not sell Gmail data or use it for advertising.',
    );
  });

  it('leaves visible comparison descriptions unchanged when only the meta description moves', () => {
    expect(comparisonBySlug('unroll-me')?.description).toBe(
      'A source-backed comparison of DeclutrMail and Unroll.Me on Gmail cleanup, blocking, digests, email-data access, the market-research business model and cost.',
    );
    expect(comparisonBySlug('gmail')?.description).toBe(
      "A source-backed comparison of DeclutrMail and Gmail's own cleanup tools — Manage subscriptions, bulk search actions, and unsubscribe — for preview, recovery, and control by sender.",
    );
    expect(comparisonBySlug('meta-muse')?.description).toBe(
      'A source-backed comparison of DeclutrMail and Meta Muse for Gmail: a narrow cleanup tool that never fetches full message contents versus a general AI agent that can read and send mail.',
    );
  });

  it('keeps the seven rows the founder left unchanged', () => {
    expect(titleText(landing)).toBe('Clean up Gmail, one sender at a time — DeclutrMail');
    expect(landing.description).toBe(
      'Clear Gmail clutter by sender. Preview which emails will move before you confirm. Start free, with 30-day undo on Archive, Later, and Delete.',
    );
    expect(titleText(pricing)).toBe('Pricing — DeclutrMail');
    expect(pricing.description).toBe(
      'Free includes manual sender cleanup. Plus adds Screener, Autopilot and Quiet hours with no monthly limit. Pro adds the Daily Brief, Follow-ups and more inboxes.',
    );
    expect(titleText(security)).toBe('Security — DeclutrMail');
    expect(security.description).toBe(
      'DeclutrMail never fetches or stores full email contents, encrypts Google access tokens, and received Google OAuth verification approval in April 2026.',
    );
    expect(titleText(methodology)).toBe('Privacy and control — DeclutrMail');
    expect(methodology.description).toBe(
      'What DeclutrMail stores from Gmail, how suggestions are made, what changes before you confirm, and when automation can run.',
    );
    expect(titleText(compare)).toBe('Gmail cleanup tools compared side by side — DeclutrMail');
    expect(compare.description).toBe(
      'DeclutrMail vs. Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me and native Gmail — what each actually does. Official sources, unknowns left unknown.',
    );
    expect(titleText(answerUndo)).toBe('How does undo work for Gmail cleanup? — DeclutrMail');
    expect(answerUndo.description).toBe(
      'How recovery differs for Archive, Later, Delete, Keep, and sent Unsubscribe requests.',
    );
    expect(titleText(changelog)).toBe('DeclutrMail product updates — what changed, and when');
    expect(changelog.description).toBe(
      'What changed in DeclutrMail and when, listed by date with Added, Improved, and Fixed notes.',
    );
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
