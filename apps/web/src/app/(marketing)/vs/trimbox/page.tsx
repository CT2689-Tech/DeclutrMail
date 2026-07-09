import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { competitorBySlug } from '@/features/marketing/growth/vs-data';
import { VsPage } from '@/features/marketing/growth/vs-page';

const SLUG = 'trimbox' as const;
const competitor = competitorBySlug(SLUG);

export const metadata: Metadata = marketingPageMetadata({
  title: competitor
    ? `DeclutrMail vs ${competitor.name} — sender-level Gmail cleanup`
    : 'Comparison — DeclutrMail',
  description: competitor
    ? `${competitor.blurb} Honest buyer’s guide with a 10-row feature comparison.`
    : 'Compare DeclutrMail to other Gmail cleanup tools.',
  path: `/vs/${SLUG}`,
});

export default function Page() {
  if (!competitor) notFound();
  return <VsPage competitor={competitor} />;
}
