import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ANSWER_ARTICLES, ANSWER_SLUGS } from './answer-content';
import { ArticlePage } from './article-page';
import { BLOG_ARTICLES, BLOG_SLUGS } from './blog-content';
import { CHANGELOG_ENTRIES } from './changelog-content';
import { FAQ_ENTRIES } from './faq-content';
import { HOW_TO_ARTICLES, HOW_TO_SLUGS } from './how-to-content';
import { ANSWERS_HUB, HOW_TO_HUB, type LearnHubDefinition } from './hub-content';
import {
  AnswersIndexPage,
  BlogIndexPage,
  ChangelogPage,
  FaqPage,
  HowToIndexPage,
} from './index-pages';
import type { LearnArticle } from './types';

function articleText(article: LearnArticle): string {
  return [
    article.title,
    article.description,
    article.intro,
    article.quickAnswer ?? '',
    ...article.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs,
      ...(section.bullets ?? []),
      ...(section.steps?.flatMap((step) => [step.name, step.text]) ?? []),
      section.callout?.title ?? '',
      section.callout?.body ?? '',
    ]),
  ].join(' ');
}

/**
 * Titles are literals, not patterns. Two answer titles end in `?` and a
 * how-to title carries one mid-string, which makes the preceding
 * character optional — an accessible-name assertion that quietly stops
 * matching what it names.
 */
function byName(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function wordCount(article: LearnArticle): number {
  return articleText(article).trim().split(/\s+/).filter(Boolean).length;
}

const HOW_TO = HOW_TO_SLUGS.map((slug) => HOW_TO_ARTICLES[slug]);
const ANSWERS = ANSWER_SLUGS.map((slug) => ANSWER_ARTICLES[slug]);
const BLOG = BLOG_SLUGS.map((slug) => BLOG_ARTICLES[slug]);
const ALL_ARTICLES = [...HOW_TO, ...ANSWERS, ...BLOG];

describe('public learning content registry', () => {
  it('ships exactly the published how-to routes and five answer routes', () => {
    expect(HOW_TO_SLUGS).toEqual([
      'clean-gmail-by-sender',
      'bulk-delete-emails-from-one-sender',
      'gmail-storage-full',
      'auto-archive-future-emails-in-gmail',
      'stop-promotional-emails-gmail',
      'unsubscribe-from-emails-gmail',
    ]);
    expect(ANSWER_SLUGS).toEqual([
      'is-it-safe-to-connect-gmail-app',
      'what-is-metadata-only-email-analysis',
      'how-undo-works-for-gmail-cleanup',
      'best-way-to-clean-gmail-2026',
      'sender-level-vs-message-level-cleanup',
    ]);
    expect(new Set(ALL_ARTICLES.map((article) => article.path)).size).toBe(ALL_ARTICLES.length);
  });

  it('keeps every guide and answer substantive instead of shipping thin SEO shells', () => {
    for (const article of [...HOW_TO, ...ANSWERS]) {
      expect(article.sections.length, article.path).toBeGreaterThanOrEqual(5);
      expect(wordCount(article), `${article.path} word count`).toBeGreaterThanOrEqual(450);
      expect(article.related.length, article.path).toBeGreaterThanOrEqual(3);
    }
  });

  it('backs every how-to guide with a primary source a reader can open', () => {
    // Widened from `support.google.com`-only on 2026-08-27, following the
    // hostname-allowlist precedent already used for comparison sources
    // (`comparison/comparison-data.test.ts`). The old rule made a guide
    // about a third-party sender unshippable: its only honest citation is
    // that sender's own help page, and a Google-only list rejected it —
    // which pushed the brand-specific claims onto the page UNSOURCED,
    // under a heading that says "Primary sources". A narrower rule that
    // forces unbacked claims is worse than a wider rule that permits
    // first-party ones.
    //
    // The invariant is unchanged and is what actually matters: every
    // source must be HTTPS and must be the PRIMARY party for the claim —
    // Google for native Gmail behaviour, the sender for its own email
    // settings. Never a review site, a blog, or a competitor.
    const allowedHosts = new Set([
      // Native Gmail behaviour — the primary party for anything the
      // Gmail UI itself does.
      'support.google.com',
      // Senders documenting their own email settings. Add a host here
      // only when a guide cites that sender's OWN help or preference
      // documentation.
      'help.linkedin.com',
      'support.tiktok.com',
      'help.uber.com',
      'www.temu.com',
    ]);

    for (const article of HOW_TO) {
      expect(article.sources?.length, article.path).toBeGreaterThan(0);
      for (const source of article.sources ?? []) {
        const url = new URL(source.href);
        expect(url.protocol, `${article.path} ${source.href}`).toBe('https:');
        expect(allowedHosts.has(url.hostname), `${article.path} ${source.href}`).toBe(true);
      }
    }
  });

  it('ships three complete first-party launch essays', () => {
    expect(BLOG).toHaveLength(3);
    for (const article of BLOG) {
      expect(article.kind).toBe('Launch essay');
      expect(article.sections.length, article.path).toBeGreaterThanOrEqual(6);
      expect(wordCount(article), `${article.path} word count`).toBeGreaterThanOrEqual(700);
    }
  });

  it('dates every article with an attributable publish and modify date', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const article of ALL_ARTICLES) {
      expect(article.publishedAt, article.path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.updatedAt, article.path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A dateModified that precedes datePublished reads as stale to a
      // crawler and cannot be true of any real edit.
      expect(
        article.updatedAt >= article.publishedAt,
        `${article.path} claims an edit before it was published`,
      ).toBe(true);
      // Freshness is a public claim, so it may never be post-dated.
      expect(article.updatedAt <= today, `${article.path} claims a future edit`).toBe(true);
    }
  });

  it('labels every visual example as made up', () => {
    const examples = ALL_ARTICLES.flatMap((article) => (article.example ? [article.example] : []));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.label).toBe('Made-up example');
    }
  });

  it('pins the non-negotiable product truth boundaries', () => {
    const copy = ALL_ARTICLES.map(articleText).join(' ');
    expect(copy).not.toMatch(/every action (?:is|remains) (?:undoable|reversible)/i);
    expect(copy).not.toMatch(
      /manual (?:archive|later|delete) (?:creates|installs|becomes|applies to) (?:a )?future/i,
    );
    expect(copy).toMatch(/manual Archive, Later, and Delete affect current matched email/i);
    expect(copy).toMatch(/delivered unsubscribe request (?:is|cannot).{0,25}(?:one-way|recalled)/i);
    expect(copy).toMatch(/never fetches?(?: or stores?)? full email contents/i);
    expect(copy).toMatch(/Gmail(?:’s)? (?:short )?(?:generated )?preview snippet/i);
    expect(copy).toMatch(/does store Gmail preview snippets/i);
    expect(copy).toMatch(/Daily Brief.{0,140}Anthropic/i);
  });
});

describe('shared learning surfaces', () => {
  it('renders an accessible article with one h1 and matching JSON-LD', () => {
    const article = HOW_TO_ARTICLES['clean-gmail-by-sender'];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<ArticlePage article={article} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(article.title);
    expect(screen.getByLabelText('Made-up example')).toBeInTheDocument();
    const jsonLd = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    ) as { '@type': string; name: string };
    expect(jsonLd).toMatchObject({ '@type': 'HowTo', name: article.title });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('carries the freshness dates into the structured data', () => {
    const article = HOW_TO_ARTICLES['clean-gmail-by-sender'];
    const { container } = render(<ArticlePage article={article} />);
    const jsonLd = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    ) as Record<string, unknown>;
    expect(jsonLd).toMatchObject({
      '@type': 'HowTo',
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
    });
  });

  it('marks up the question an answer page exists to answer', () => {
    // Pinned so that retitling an answer out of interrogative form is a
    // visible decision rather than a silently dropped FAQPage.
    expect(ANSWERS.filter((article) => article.title.endsWith('?'))).toHaveLength(4);

    const article = ANSWER_ARTICLES['is-it-safe-to-connect-gmail-app'];
    const { container } = render(<ArticlePage article={article} />);
    const nodes = [...container.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) => JSON.parse(script.textContent ?? '{}') as Record<string, unknown>,
    );

    expect(nodes.map((node) => node['@type'])).toEqual(['Article', 'FAQPage']);
    expect(nodes[1]?.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: article.title,
        acceptedAnswer: { '@type': 'Answer', text: article.quickAnswer },
      },
    ]);
  });

  it('omits FAQPage on the answer whose title is a comparison, not a question', () => {
    const { container } = render(
      <ArticlePage article={ANSWER_ARTICLES['sender-level-vs-message-level-cleanup']} />,
    );
    const types = [...container.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) => (JSON.parse(script.textContent ?? '{}') as Record<string, unknown>)['@type'],
    );
    expect(types).toEqual(['Article']);
  });

  it('renders all three published posts on the article index', () => {
    render(<BlogIndexPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /calmer, inspectable email/i,
    );
    for (const article of BLOG) {
      expect(screen.getByRole('link', { name: byName(article.title) })).toHaveAttribute(
        'href',
        article.path,
      );
    }
  });

  it.each([
    ['how-to', HOW_TO_HUB, <HowToIndexPage key="how-to" />] as const,
    ['answers', ANSWERS_HUB, <AnswersIndexPage key="answers" />] as const,
  ])(
    'gives the %s cluster an addressable hub listing every page in it',
    (_name, hub: LearnHubDefinition, element) => {
      const { container } = render(element);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(hub.heading);
      for (const article of hub.articles) {
        expect(screen.getByRole('link', { name: byName(article.title) })).toHaveAttribute(
          'href',
          article.path,
        );
      }

      const jsonLd = JSON.parse(
        container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
      ) as { '@type': string; mainEntity: { itemListElement: Array<{ url: string }> } };
      expect(jsonLd['@type']).toBe('CollectionPage');
      // The ItemList must be the cluster, in order — a hub that lists nine
      // of ten pages is the crawl gap these hubs exist to close.
      expect(jsonLd.mainEntity.itemListElement.map((item) => item.url)).toEqual(
        hub.articles.map((article) => `https://declutrmail.com${article.path}`),
      );
    },
  );

  it('leaves /blog as essays, pointing at each cluster hub instead of restating it', () => {
    render(<BlogIndexPage />);

    for (const [href, name] of [
      ['/how-to', HOW_TO_HUB.heading],
      ['/answers', ANSWERS_HUB.heading],
    ] as const) {
      expect(screen.getByRole('link', { name: byName(name) })).toHaveAttribute('href', href);
    }
    // The guide cards themselves must no longer be duplicated here.
    for (const article of [...HOW_TO, ...ANSWERS]) {
      expect(screen.queryByRole('link', { name: byName(article.title) })).toBeNull();
    }
  });

  it('renders a complete FAQ and matching FAQPage structured data', () => {
    const { container } = render(<FaqPage />);
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(15);
    for (const entry of FAQ_ENTRIES) {
      expect(screen.getByText(entry.question)).toBeInTheDocument();
    }
    const jsonLd = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    ) as { '@type': string; mainEntity: unknown[] };
    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity).toHaveLength(FAQ_ENTRIES.length);
  });

  it('renders every changelog entry', () => {
    render(<ChangelogPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/what changed/i);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(screen.getByText(entry.title)).toBeInTheDocument();
    }
  });

  // The inverse of the old assertion, and the more important one now: the
  // page must leak NO internal identifier. `evidence` is retained in the
  // data so `pnpm check-changelog` can verify the page against git, which
  // makes accidentally rendering it a live risk rather than a theoretical
  // one — and every such link would 404 once the repository goes private.
  //
  // A pure absence test is worthless on its own: it passes identically when
  // the page renders nothing, and its loop runs ZERO assertions if
  // `evidence` is ever emptied. The first version of this test had both
  // holes (Codex stop-review 2026-07-29). Hence the positive controls — the
  // test must first prove it can SEE the thing it claims is clean.
  it('leaks no pull-request number, commit hash, or repository link', () => {
    const { container } = render(<ChangelogPage />);
    const text = container.textContent ?? '';

    // Positive controls: there is a page, it has entries, and there is
    // something to look for. Without these the absence checks below are
    // vacuous.
    const receipts = CHANGELOG_ENTRIES.flatMap((entry) => entry.evidence);
    expect(receipts.length).toBeGreaterThan(0);
    expect(text).toContain('What changed');
    expect(text).toContain(CHANGELOG_ENTRIES[0]!.title);
    expect(container.querySelectorAll('article[id]').length).toBe(CHANGELOG_ENTRIES.length);
    expect(container.querySelectorAll('a').length).toBeGreaterThan(0);

    for (const receipt of receipts) {
      expect(text).not.toContain(receipt.commit);
      expect(text).not.toContain(`#${receipt.pullRequest}`);
    }
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => /github\.com|\/pull\//.test(href))).toEqual([]);
  });
});

describe('changelog evidence', () => {
  // Invariants, not a pinned count: the log GROWS on every release, so
  // asserting a length (or a fixed set of dates) would fail the next
  // honest append and teach the author to edit the assertion rather
  // than read it. What must hold for every entry, forever, is that it
  // is dated, ordered, and carries a real repository receipt.
  it('uses real repository-shaped receipts without invented semver', () => {
    expect(CHANGELOG_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The anchor the RSS <guid> and the on-page heading share.
      expect(entry.id).toBe(entry.date);
      expect(entry.title).not.toMatch(/^v?\d+\.\d+/);
      expect(entry.evidence.length).toBeGreaterThan(0);
      for (const evidence of entry.evidence) {
        expect(evidence.commit).toMatch(/^[0-9a-f]{8}$/);
        expect(evidence.pullRequest).toBeGreaterThan(0);
      }
    }
  });

  it('reads newest first', () => {
    const dates = CHANGELOG_ENTRIES.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('gives every entry at least one user-facing line', () => {
    for (const entry of CHANGELOG_ENTRIES) {
      const lines = [...entry.added, ...entry.improved, ...entry.fixed];
      expect(lines.length, `${entry.id} has no Added/Improved/Fixed lines`).toBeGreaterThan(0);
    }
  });
});
