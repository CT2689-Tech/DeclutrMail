import type { Metadata } from 'next';
import Link from 'next/link';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = {
  ...marketingPageMetadata({
    title: 'Pricing changelog — DeclutrMail',
    description: WS1_COPY['pricing.changelog.intro'],
    path: '/pricing/changelog',
  }),
  robots: { index: false, follow: true },
};

export default function PricingChangelogPage() {
  return (
    <div className="dm-pricing" data-testid="pricing-changelog">
      <h1>{fillStory(WS1_COPY['pricing.changelog.h1'])}</h1>
      <p>{fillStory(WS1_COPY['pricing.changelog.intro'])}</p>
      <article>
        <h2>{WS1_COPY['pricing.changelog.current']}</h2>
        <p>{fillStory(WS1_COPY['pricing.changelog.entry.2026-10-27'])}</p>
      </article>
      <p>
        <Link href="/pricing">Pricing</Link>
      </p>
    </div>
  );
}
