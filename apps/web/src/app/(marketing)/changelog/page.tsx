import type { Metadata } from 'next';
import { ChangelogPage as ChangelogSurface } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail product updates — what changed, and when',
  description:
    'What changed in DeclutrMail and when, listed by date with Added, Improved, and Fixed notes.',
  path: '/changelog',
});

export default function ChangelogPage() {
  return <ChangelogSurface />;
}
