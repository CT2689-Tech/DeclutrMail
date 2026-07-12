import type { Metadata } from 'next';
import { ChangelogPage as ChangelogSurface } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail changelog — evidence-linked build history',
  description:
    'An evidence-linked build log derived from DeclutrMail repository history, with Added, Improved, and Fixed notes plus pull-request receipts.',
  path: '/changelog',
});

export default function ChangelogPage() {
  return <ChangelogSurface />;
}
