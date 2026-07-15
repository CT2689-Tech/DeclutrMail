import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticlePage } from '@/features/marketing/learn/article-page';
import { BLOG_ARTICLES, BLOG_SLUGS, type BlogSlug } from '@/features/marketing/learn/blog-content';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

function isBlogSlug(value: string): value is BlogSlug {
  return (BLOG_SLUGS as readonly string[]).includes(value);
}

export function generateStaticParams() {
  return BLOG_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isBlogSlug(slug)) return {};
  const article = BLOG_ARTICLES[slug];
  return marketingPageMetadata({
    title: `${article.title} — DeclutrMail Journal`,
    description: article.description,
    path: article.path,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isBlogSlug(slug)) notFound();
  return <ArticlePage article={BLOG_ARTICLES[slug]} />;
}
