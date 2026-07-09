import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { answerBySlug } from '@/features/marketing/growth/answers-data';
import { AnswerPageView } from '@/features/marketing/growth/answer-page';

const SLUG = 'is-it-safe-to-connect-gmail-app';
const page = answerBySlug(SLUG);

export const metadata: Metadata = marketingPageMetadata({
  title: page ? `${page.question} — DeclutrMail` : 'Answers — DeclutrMail',
  description: page?.description ?? 'Answers about DeclutrMail and Gmail cleanup.',
  path: `/answers/${SLUG}`,
});

export default function Page() {
  if (!page) notFound();
  return <AnswerPageView page={page} />;
}
