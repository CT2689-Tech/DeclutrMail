import type { Metadata } from 'next';
import { FaqPage as FaqSurface } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail FAQ — Gmail access, actions, undo, and privacy',
  description:
    'Precise answers about stored Gmail metadata, full-body boundaries, Anthropic processing, Archive, Later, Delete, Unsubscribe, Autopilot, plans, and account deletion.',
  path: '/faq',
});

export default function FaqPage() {
  return <FaqSurface />;
}
