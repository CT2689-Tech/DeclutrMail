import type { Metadata } from 'next';
import { BlogIndexPage } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail Journal — previews, undo, and bulk email limits',
  description:
    'First-party essays about sender-level email decisions, what DeclutrMail stores and never fetches, action previews, and honest Gmail recovery.',
  path: '/blog',
});

export default function BlogPage() {
  return <BlogIndexPage />;
}
