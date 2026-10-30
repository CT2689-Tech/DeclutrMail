import registry from './published-blog.json';
import type { LearnArticle } from './types';

// Only content staged from an exact approved draft enters this public registry.
// The content-pipeline contract suite validates its shape and content digests.
export const PUBLISHED_BLOG_ARTICLES: Record<string, LearnArticle> = Object.fromEntries(
  (registry.articles as { article: LearnArticle }[]).map(({ article }) => [article.slug, article]),
);

export const PUBLISHED_BLOG_SLUGS = Object.keys(PUBLISHED_BLOG_ARTICLES);
