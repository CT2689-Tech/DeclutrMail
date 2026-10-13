'use client';

import Link from 'next/link';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, refundLine } from '@declutrmail/shared/entitlements';

/** Launch teaser. Loaded only after the public catalog says PRICING_V2 is on. */
export function PricingTeaserStory({
  passEnabled,
  locale = 'usd',
}: {
  passEnabled: boolean;
  locale?: 'usd' | 'inr';
}) {
  const plans = [
    {
      name: fillStory(WS1_COPY['pricing.free.name'], locale),
      line: fillStory(WS1_COPY['pricing.free.renewal'], locale),
      cta: fillStory(WS1_COPY['pricing.free.cta'], locale),
      href: '/sign-in',
    },
    ...(passEnabled
      ? [
          {
            name: fillStory(WS1_COPY['pricing.pass.name'], locale),
            line: fillStory(WS1_COPY['price.passLine'], locale),
            cta: fillStory(WS1_COPY['pricing.pass.cta'], locale),
            href: '/billing?plan=plus&cycle=annual&offer=pass_onetime',
          },
        ]
      : []),
    {
      name: fillStory(WS1_COPY['pricing.plus.name'], locale),
      line: fillStory(WS1_COPY['price.plusLine'], locale),
      cta: fillStory(WS1_COPY['pricing.plus.cta'], locale),
      href: '/billing?plan=plus&cycle=annual',
    },
  ];
  return (
    <section
      id="plans"
      className="dm-mkt-section dm-mkt-shell dm-mkt-center dm-mkt-pricing"
      data-testid="pricing-teaser-story"
    >
      <h2 className="dm-mkt-h2">
        {fillStory(WS1_COPY[passEnabled ? 'pricing.h1.passOn' : 'pricing.h1.passOff'], locale)}
      </h2>
      <div className="dm-mkt-tiers">
        {plans.map((plan) => (
          <div key={plan.name} className="dm-mkt-tier">
            <div className="dm-mkt-tier-name">{plan.name}</div>
            <div className="dm-mkt-tier-price">{plan.line}</div>
            <a href={plan.href}>{plan.cta}</a>
          </div>
        ))}
      </div>
      <p>
        <Link href="/pricing">{fillStory(WS1_COPY['pricing.teaser.cta'])}</Link>
      </p>
      <p className="dm-mkt-refund-note">
        <Link href="/refunds">{refundLine()}</Link>
      </p>
    </section>
  );
}
