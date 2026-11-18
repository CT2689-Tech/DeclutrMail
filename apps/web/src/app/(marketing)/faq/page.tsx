import type { Metadata } from 'next';
import { FaqPage as FaqSurface } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DeclutrMail FAQ — Gmail access, actions, undo, and privacy',
  description:
    'Clear answers about the Gmail details DeclutrMail stores, Anthropic processing, Archive, Later, Delete, Unsubscribe, Autopilot, plans, and account deletion.',
  path: '/faq',
});

export default function FaqPage() {
  return <FaqSurface />;
}
