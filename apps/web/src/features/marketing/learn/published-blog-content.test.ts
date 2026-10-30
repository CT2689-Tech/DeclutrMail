import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./published-blog.json', () => ({
  default: {
    version: 1,
    articles: [
      {
        article: {
          slug: 'approved-gmail-search-example',
          path: '/blog/approved-gmail-search-example',
          kind: 'Article',
          title: 'Approved Gmail search example',
          description: 'A fictional publication fixture.',
          intro: 'Review the matching messages first.',
          publishedAt: '2026-10-30',
          updatedAt: '2026-10-30',
          readingMinutes: 2,
          sections: [{ id: 'review', title: 'Review', paragraphs: ['Inspect the matches.'] }],
          sources: [],
          related: [],
        },
      },
    ],
  },
}));

import { BlogIndexPage } from './index-pages';
import { getBlogArticle, BLOG_SLUGS } from './blog-content';
import sitemap from '@/app/sitemap';
import { generateMetadata, generateStaticParams } from '@/app/(marketing)/blog/[slug]/page';

describe('approved publication integration', () => {
  it('adds the approved entry to blog discovery, route params, metadata and sitemap', async () => {
    const slug = 'approved-gmail-search-example';
    expect(BLOG_SLUGS).toContain(slug);
    const index = renderToStaticMarkup(createElement(BlogIndexPage));
    expect(index).toContain('3 launch essays');
    expect(index).not.toContain('4 launch essays');
    expect(index).toContain('Approved Gmail search example');
    expect(getBlogArticle(slug).kind).toBe('Article');
    expect(generateStaticParams()).toContainEqual({ slug });
    const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
    expect(meta.title).toMatchObject({
      absolute: 'Approved Gmail search example — DeclutrMail Journal',
    });
    expect(sitemap().find((row) => row.url.endsWith(`/blog/${slug}`))).toMatchObject({
      lastModified: '2026-10-30',
    });
    expect(BLOG_SLUGS).toContain('why-cleanup-starts-with-senders');
    expect(() => getBlogArticle('constructor')).toThrow('Missing registered');
  });
});
