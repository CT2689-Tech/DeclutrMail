import type { Metadata } from 'next';

import '@/features/marketing/landing/landing.css';
import '@/features/marketing/comparison/comparison.css';

import { ComparisonIndexScreen } from '@/features/marketing/comparison/comparison-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Compare Gmail cleanup tools — DeclutrMail',
  description:
    'Source-backed comparisons of DeclutrMail, Clean Email, Trimbox, SaneBox, Leave Me Alone, and native Gmail filters. Official sources, clear unknowns, no affiliate rankings.',
  path: '/compare',
});

export default function ComparePage() {
  return <ComparisonIndexScreen />;
}
