import type { Metadata } from 'next';
import { HOW_TO_HUB } from '@/features/marketing/learn/hub-content';
import { HowToIndexPage } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: `${HOW_TO_HUB.heading} — DeclutrMail`,
  description: HOW_TO_HUB.description,
  path: HOW_TO_HUB.path,
});

export default function HowToHubPage() {
  return <HowToIndexPage />;
}
