import type { Metadata } from 'next';

import '@/features/marketing/landing/landing.css';
import '@/features/marketing/comparison/comparison.css';

import { ComparisonIndexScreen } from '@/features/marketing/comparison/comparison-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  // No "best". The page's whole argument is that it does not rank, and a
  // title promising a winner would contradict the badge under it — the
  // one thing separating this from the competitor roundups that put
  // themselves at number one.
  title: 'Gmail cleanup tools compared side by side — DeclutrMail',
  description:
    'DeclutrMail, Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me and native Gmail, side by side on what each actually does. Official sources, unknowns left unknown, no rankings.',
  path: '/compare',
});

export default function ComparePage() {
  return <ComparisonIndexScreen />;
}
