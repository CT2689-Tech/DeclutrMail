'use client';

import Link from 'next/link';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import {
  fillStory,
  fillStoryList,
  launchPriceDisplay,
  passAmount,
  refundLine,
} from '@declutrmail/shared/entitlements';

/**
 * Launch teaser. Loaded only after the public catalog says PRICING_V2 is
 * on. Names, prices and bullets are the /pricing story's own copy, so the
 * two pages cannot quote different plans.
 */
export function PricingTeaserStory({
  passEnabled,
  locale = 'usd',
}: {
  passEnabled: boolean;
  locale?: 'usd' | 'inr';
}) {
  const prices = launchPriceDisplay(locale);
  const fill = (template: string) => fillStory(template, locale);
  const plans = [
    {
      id: 'free',
      name: fill(WS1_COPY['pricing.free.name']),
      tagline: fill(WS1_COPY['pricing.free.tagline']),
      price: prices.free.amount,
      terms: fill(WS1_COPY['pricing.free.renewal']),
      features: fillStoryList(WS1_COPY['pricing.free.features'], locale),
      cta: fill(WS1_COPY['pricing.free.cta']),
      href: '/sign-in',
    },
    ...(passEnabled
      ? [
          {
            id: 'pass',
            badge: fill(WS1_COPY['pricing.pass.badge']),
            name: fill(WS1_COPY['pricing.pass.name']),
            tagline: fill(WS1_COPY['pricing.pass.tagline']),
            price: passAmount(locale),
            terms: `${fill(WS1_COPY['pricing.pass.priceSuffix'])} · ${fill(WS1_COPY['pricing.pass.renewal'])}`,
            features: fillStoryList(WS1_COPY['pricing.pass.features'], locale),
            cta: fill(WS1_COPY['pricing.pass.cta']),
            href: '/billing?plan=plus&cycle=annual&offer=pass_onetime',
          },
        ]
      : []),
    {
      id: 'plus',
      name: fill(WS1_COPY['pricing.plus.name']),
      tagline: fill(WS1_COPY['pricing.plus.tagline']),
      price: prices.plus.amount,
      terms: `${fill(WS1_COPY['pricing.plus.priceSuffix'])} · ${fill(WS1_COPY['pricing.plus.renewal'])}`,
      features: fillStoryList(WS1_COPY['pricing.plus.features'], locale),
      cta: fill(WS1_COPY['pricing.plus.cta']),
      href: '/billing?plan=plus&cycle=annual',
    },
  ];
  const [lead, ...rest] = fill(
    WS1_COPY[passEnabled ? 'pricing.h1.passOn' : 'pricing.h1.passOff'],
  ).split(/(?<=\.)\s+/);
  return (
    <section
      id="plans"
      className="dm-home-section dm-home-pricing dm-mkt-shell"
      data-testid="pricing-teaser-story"
      aria-labelledby="dm-home-pricing-title"
    >
      <div className="dm-home-head">
        <p className="dm-home-kicker">Pricing</p>
        <h2 id="dm-home-pricing-title" className="dm-home-h2">
          {lead} {rest.length > 0 ? <em>{rest.join(' ')}</em> : null}
        </h2>
        <p className="dm-home-lede">{fill(WS1_COPY['pricing.sub'])}</p>
      </div>
      <div className="dm-home-plans" data-count={plans.length}>
        {plans.map((plan) => (
          <article
            key={plan.id}
            className="dm-home-plan"
            data-highlighted={plan.id === 'pass' ? 'true' : undefined}
          >
            {'badge' in plan && plan.badge ? (
              <span className="dm-home-plan-badge">{plan.badge}</span>
            ) : null}
            <div className="dm-home-plan-head">
              <h3>{plan.name}</h3>
              <span>{plan.tagline}</span>
            </div>
            <p className="dm-home-plan-price">
              <span className="dm-home-num">{plan.price}</span> <span>{plan.terms}</span>
            </p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <a className="dm-home-plan-cta" href={plan.href}>
              {plan.cta}
            </a>
          </article>
        ))}
      </div>
      <div className="dm-mkt-pricing-foot dm-home-pricing-foot">
        <Link href="/refunds">{refundLine()}</Link>
        <Link href="/pricing" className="dm-home-text-link">
          See full pricing <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
