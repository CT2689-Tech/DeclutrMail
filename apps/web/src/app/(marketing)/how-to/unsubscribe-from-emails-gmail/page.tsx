import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { howToBySlug } from '@/features/marketing/growth/how-to-data';
import { HowToPage } from '@/features/marketing/growth/how-to-page';

const SLUG = 'unsubscribe-from-emails-gmail';
const page = howToBySlug(SLUG);

export const metadata: Metadata = marketingPageMetadata({
  title: page ? `${page.title} — DeclutrMail` : 'How-to — DeclutrMail',
  description: page?.description ?? 'How to clean Gmail with DeclutrMail.',
  path: `/how-to/${SLUG}`,
});

export default function Page() {
  if (!page) notFound();
  return <HowToPage page={page} />;
}
