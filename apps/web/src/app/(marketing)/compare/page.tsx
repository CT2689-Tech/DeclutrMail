import type { Metadata } from 'next';

import '@/features/marketing/landing/landing.css';
import '@/features/marketing/comparison/comparison.css';

import { ComparisonIndexScreen } from '@/features/marketing/comparison/comparison-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Compare Gmail cleanup tools — DeclutrMail',
  description:
    'Comparisons of DeclutrMail, Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me and native Gmail cleanup. Official sources, clear unknowns, no rankings.',
  path: '/compare',
});

export default function ComparePage() {
  return <ComparisonIndexScreen />;
}
