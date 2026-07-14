import type { Metadata } from 'next';
import { BlogIndexPage } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail Journal — sender-first Gmail cleanup',
  description:
    'First-party essays about sender-level email decisions, metadata-only privacy boundaries, action previews, and honest Gmail recovery.',
  path: '/blog',
});

export default function BlogPage() {
  return <BlogIndexPage />;
}
