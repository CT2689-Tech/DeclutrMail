import type { Metadata } from 'next';
import { BlogIndexPage } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail articles — previews, undo, and the limits of bulk email',
  description:
    'First-party essays about decisions by sender, what DeclutrMail stores and never fetches, action previews, and honest Gmail recovery.',
  path: '/blog',
});

export default function BlogPage() {
  return <BlogIndexPage />;
}
