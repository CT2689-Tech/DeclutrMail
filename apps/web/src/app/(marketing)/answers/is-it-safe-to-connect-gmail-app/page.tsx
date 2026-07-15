import type { Metadata } from 'next';
import { ANSWER_ARTICLES } from '@/features/marketing/learn/answer-content';
import { ArticlePage } from '@/features/marketing/learn/article-page';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

const article = ANSWER_ARTICLES['is-it-safe-to-connect-gmail-app'];

export const metadata: Metadata = marketingPageMetadata({
  title: `${article.title} — DeclutrMail`,
  description: article.description,
  path: article.path,
});

export default function GmailAppSafetyAnswerPage() {
  return <ArticlePage article={article} />;
}
