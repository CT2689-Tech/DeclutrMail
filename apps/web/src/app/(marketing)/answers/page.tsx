import type { Metadata } from 'next';
import { ANSWERS_HUB } from '@/features/marketing/learn/hub-content';
import { AnswersIndexPage } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: `${ANSWERS_HUB.heading} — DeclutrMail`,
  description: ANSWERS_HUB.description,
  path: ANSWERS_HUB.path,
});

export default function AnswersHubPage() {
  return <AnswersIndexPage />;
}
