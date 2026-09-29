import type { Metadata } from 'next';
import { ChangelogPage as ChangelogSurface } from '@/features/marketing/learn/index-pages';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

// Historical entries remain available at their existing URL, but the
// archive is incomplete after July 2026. Do not advertise it as a current
// release log to search engines until its evidence-backed entries catch up.
export const metadata: Metadata = {
  ...marketingPageMetadata({
    title: 'DeclutrMail product updates — what changed, and when',
    description:
      'What changed in DeclutrMail and when, listed by date with Added, Improved, and Fixed notes.',
    path: '/changelog',
  }),
  robots: { index: false, follow: true },
};

export default function ChangelogPage() {
  return <ChangelogSurface />;
}
