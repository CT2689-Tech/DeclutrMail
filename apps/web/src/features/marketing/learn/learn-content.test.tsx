import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ANSWER_ARTICLES, ANSWER_SLUGS } from './answer-content';
import { ArticlePage } from './article-page';
import { BLOG_ARTICLES, BLOG_SLUGS } from './blog-content';
import { CHANGELOG_ENTRIES } from './changelog-content';
import { FAQ_ENTRIES } from './faq-content';
import { HOW_TO_ARTICLES, HOW_TO_SLUGS } from './how-to-content';
import { BlogIndexPage, ChangelogPage, FaqPage } from './index-pages';
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

function wordCount(article: LearnArticle): number {
  return articleText(article).trim().split(/\s+/).filter(Boolean).length;
}

const HOW_TO = HOW_TO_SLUGS.map((slug) => HOW_TO_ARTICLES[slug]);
const ANSWERS = ANSWER_SLUGS.map((slug) => ANSWER_ARTICLES[slug]);
const BLOG = BLOG_SLUGS.map((slug) => BLOG_ARTICLES[slug]);
const ALL_ARTICLES = [...HOW_TO, ...ANSWERS, ...BLOG];

describe('public learning content registry', () => {
  it('ships exactly the five D132 how-to routes and five answer routes', () => {
    expect(HOW_TO_SLUGS).toEqual([
      'clean-gmail-by-sender',
      'bulk-delete-emails-from-one-sender',
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

  it('backs every native Gmail guide with current Google primary documentation', () => {
    for (const article of HOW_TO) {
      expect(article.sources?.length, article.path).toBeGreaterThan(0);
      for (const source of article.sources ?? []) {
        expect(source.href, article.path).toMatch(/^https:\/\/support\.google\.com\//);
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

  it('labels every visual example as synthetic', () => {
    const examples = ALL_ARTICLES.flatMap((article) => (article.example ? [article.example] : []));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.label).toBe('Illustrative example — synthetic data');
    }
  });

  it('pins the non-negotiable product truth boundaries', () => {
    const copy = ALL_ARTICLES.map(articleText).join(' ');
    expect(copy).not.toMatch(/every action (?:is|remains) (?:undoable|reversible)/i);
    expect(copy).not.toMatch(
      /manual (?:archive|later|delete) (?:creates|installs|becomes|applies to) (?:a )?future/i,
    );
    expect(copy).toMatch(/manual Archive, Later, and Delete affect current matched mail/i);
    expect(copy).toMatch(/delivered unsubscribe request (?:is|cannot).{0,25}(?:one-way|recalled)/i);
    expect(copy).toMatch(/full (?:and raw )?message bodies?.{0,80}(?:not fetched|never fetched)/i);
    expect(copy).toMatch(/Gmail(?:’s)? (?:short )?(?:generated )?preview snippet/i);
    expect(copy).toMatch(/Gmail snippets stored/i);
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
    expect(screen.getByLabelText('Illustrative example — synthetic data')).toBeInTheDocument();
    const jsonLd = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    ) as { '@type': string; name: string };
    expect(jsonLd).toMatchObject({ '@type': 'HowTo', name: article.title });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders all three real journal posts on the blog index', () => {
    render(<BlogIndexPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /calmer, inspectable email/i,
    );
    for (const article of BLOG) {
      expect(screen.getByRole('link', { name: new RegExp(article.title) })).toHaveAttribute(
        'href',
        article.path,
      );
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

  it('renders evidence links for every changelog item', () => {
    render(<ChangelogPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/repository receipts/i);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(screen.getByText(entry.title)).toBeInTheDocument();
      for (const evidence of entry.evidence) {
        expect(
          screen.getByRole('link', {
            name: `PR #${evidence.pullRequest} · ${evidence.commit}`,
          }),
        ).toHaveAttribute('href', expect.stringContaining(`/pull/${evidence.pullRequest}`));
      }
    }
  });
});

describe('changelog evidence', () => {
  it('uses real repository-shaped receipts without invented semver', () => {
    expect(CHANGELOG_ENTRIES).toHaveLength(3);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.date).toMatch(/^2026-07-(08|09|10)$/);
      expect(entry.title).not.toMatch(/^v?\d+\.\d+/);
      expect(entry.evidence.length).toBeGreaterThan(0);
      for (const evidence of entry.evidence) {
        expect(evidence.commit).toMatch(/^[0-9a-f]{8}$/);
        expect(evidence.pullRequest).toBeGreaterThan(0);
      }
    }
  });
});
