import type { Metadata } from 'next';
import { ANSWER_ARTICLES } from '@/features/marketing/learn/answer-content';
import { ArticlePage } from '@/features/marketing/learn/article-page';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

const article = ANSWER_ARTICLES['what-is-metadata-only-email-analysis'];

export const metadata: Metadata = marketingPageMetadata({
  title: `${article.title} — DeclutrMail`,
  description: article.description,
  path: article.path,
});

export default function MetadataOnlyAnswerPage() {
  return <ArticlePage article={article} />;
}
