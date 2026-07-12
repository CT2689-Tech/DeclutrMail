import type { Metadata } from 'next';
import { ANSWER_ARTICLES } from '@/features/marketing/learn/answer-content';
import { ArticlePage } from '@/features/marketing/learn/article-page';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

const article = ANSWER_ARTICLES['sender-level-vs-message-level-cleanup'];

export const metadata: Metadata = marketingPageMetadata({
  title: `${article.title} — DeclutrMail`,
  description: article.description,
  path: article.path,
});

export default function SenderVsMessageAnswerPage() {
  return <ArticlePage article={article} />;
}
