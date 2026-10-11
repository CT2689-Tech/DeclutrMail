import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, isPricingV2, PRICING_VERSION } from '@declutrmail/shared/entitlements';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Pricing changelog — DeclutrMail',
  description: WS1_COPY['pricing.changelog.intro'],
  path: '/pricing/changelog',
});

function launchDateLabel(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${PRICING_VERSION}T00:00:00Z`));
}

export default function PricingChangelogPage() {
  if (!isPricingV2()) redirect('/pricing');
  return (
    <div className="dm-pricing" data-testid="pricing-changelog">
      <h1>{fillStory(WS1_COPY['pricing.changelog.h1'])}</h1>
      <p>{fillStory(WS1_COPY['pricing.changelog.intro'])}</p>
      <article>
        <h2>{launchDateLabel()}</h2>
        <p>{fillStory(WS1_COPY['pricing.changelog.entry.2026-10-27'])}</p>
      </article>
      <p>
        <Link href="/pricing">Pricing</Link>
      </p>
    </div>
  );
}
