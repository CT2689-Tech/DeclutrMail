import type { Metadata } from 'next';
import { ArticlePage } from '@/features/marketing/learn/article-page';
import { HOW_TO_ARTICLES } from '@/features/marketing/learn/how-to-content';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

const article = HOW_TO_ARTICLES['bulk-delete-emails-from-one-sender'];

export const metadata: Metadata = marketingPageMetadata({
  title: 'Delete all emails from one sender in Gmail | DeclutrMail',
  description: article.description,
  path: article.path,
});

export default function BulkDeleteOneSenderPage() {
  return <ArticlePage article={article} />;
}
