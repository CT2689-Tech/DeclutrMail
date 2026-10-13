'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import {
  fillStory,
  fillStoryList,
  indiaFaqAnswer,
  moneyAmount,
  passAmount,
  plusAmount,
  pricePromiseLines,
  promoBanner,
  refundLine,
} from '@declutrmail/shared/entitlements';

import { PricingTrustSlot } from '@/features/marketing/trust/pricing-trust-slot';
import { track } from '@/lib/posthog';

import { navigateToCheckout, navigateToFreeApp } from './cta';
import { CheckGlyph } from './tier-card';

const COLLAPSE_AFTER = 4;

export function PricingStory({
  passEnabled,
  locale,
  now,
  rupeePurchasesOpen = false,
  inrPaused = false,
}: {
  passEnabled: boolean;
  locale: 'usd' | 'inr';
  now: string;
  /** India Paddle prices are configured and this server can sign checkout geo. */
  rupeePurchasesOpen?: boolean;
  /** This visitor is in India and rupee checkout is not open. Prices stay USD. */
  inrPaused?: boolean;
}) {
  const router = useRouter();
  const push = (path: string) => router.push(path);
  const banner = promoBanner(new Date(now), passEnabled);
  const h1 = fillStory(WS1_COPY[passEnabled ? 'pricing.h1.passOn' : 'pricing.h1.passOff'], locale);
  const cards = [
    {
      id: 'free' as const,
      name: fillStory(WS1_COPY['pricing.free.name'], locale),
      tagline: fillStory(WS1_COPY['pricing.free.tagline'], locale),
      price: moneyAmount(0, locale),
      suffix: '',
      renewal: fillStory(WS1_COPY['pricing.free.renewal'], locale),
      features: fillStoryList(WS1_COPY['pricing.free.features'], locale),
      cta: fillStory(WS1_COPY['pricing.free.cta'], locale),
      expand: null,
      paid: false,
    },
    ...(passEnabled
      ? [
          {
            id: 'pass' as const,
            name: fillStory(WS1_COPY['pricing.pass.name'], locale),
            tagline: fillStory(WS1_COPY['pricing.pass.tagline'], locale),
            price: passAmount(locale),
            suffix: fillStory(WS1_COPY['pricing.pass.priceSuffix'], locale),
            renewal: fillStory(WS1_COPY['pricing.pass.renewal'], locale),
            features: fillStoryList(WS1_COPY['pricing.pass.features'], locale),
            cta: fillStory(WS1_COPY['pricing.pass.cta'], locale),
            expand: fillStory(WS1_COPY['pricing.features.expandPass'], locale),
            paid: true,
          },
        ]
      : []),
    {
      id: 'plus' as const,
      name: fillStory(WS1_COPY['pricing.plus.name'], locale),
      tagline: fillStory(WS1_COPY['pricing.plus.tagline'], locale),
      price: plusAmount(locale),
      suffix: fillStory(WS1_COPY['pricing.plus.priceSuffix'], locale),
      renewal: fillStory(WS1_COPY['pricing.plus.renewal'], locale),
      features: fillStoryList(WS1_COPY['pricing.plus.features'], locale),
      cta: fillStory(WS1_COPY['pricing.plus.cta'], locale),
      expand: fillStory(WS1_COPY['pricing.features.expand'], locale),
      paid: true,
    },
  ];

  return (
    <div className="dm-pricing" data-testid="pricing-story">
      <header className="dm-pricing-head">
        <h1>{h1}</h1>
        <p>{fillStory(WS1_COPY['pricing.sub'], locale)}</p>
      </header>
      {inrPaused || (locale === 'inr' && !rupeePurchasesOpen) ? (
        <p className="dm-pricing-oauth">{WS1_COPY['pricing.inrPaused.notice']}</p>
      ) : null}
      {banner ? (
        <p className="dm-pricing-promo" data-testid="promo-banner">
          {banner}
        </p>
      ) : null}
      <div className="dm-pricing-tiers" data-count={cards.length} style={{ marginTop: 28 }}>
        {cards.map((card) => (
          <StoryCard
            key={card.id}
            card={card}
            highlighted={card.id === 'pass'}
            onCta={() => {
              if (card.id === 'free') return navigateToFreeApp(push);
              if (card.id === 'pass') {
                void track('pass_selected', { source: 'pricing' });
                void track('upgrade_cta_clicked', { source: 'pricing', plan: 'pass' });
                return navigateToCheckout(push, {
                  plan: 'plus',
                  cycle: 'annual',
                  offer: 'pass_onetime',
                });
              }
              void track('plus_selected', { source: 'pricing' });
              void track('upgrade_cta_clicked', { source: 'pricing', plan: 'plus' });
              return navigateToCheckout(push, { plan: 'plus', cycle: 'annual' });
            }}
          />
        ))}
      </div>
      <PricingTrustSlot />
      <p className="dm-pricing-pro-row">
        {fillStory(WS1_COPY['pricing.proRow'], locale)}{' '}
        <Link href="/pricing#pro-waitlist">
          {fillStory(WS1_COPY['pricing.proRow.link'], locale)}
        </Link>
      </p>
      <section id="pro-waitlist">
        <h2>{fillStory(WS1_COPY['waitlist.pro.title'], locale)}</h2>
        <p>{fillStory(WS1_COPY['waitlist.pro.body'], locale)}</p>
      </section>
      <section>
        <h2>{fillStory(WS1_COPY['pricing.counts.title'], locale)}</h2>
        {fillStoryList(WS1_COPY['pricing.counts.body'], locale).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
      <p>{fillStory(WS1_COPY['pricing.taxes'], locale)}</p>
      <section>
        <h2>{fillStory(WS1_COPY['pricing.faq.charged.q'], locale)}</h2>
        <p>
          {fillStory(
            WS1_COPY[passEnabled ? 'pricing.faq.charged.a' : 'pricing.faq.charged.a.passOff'],
            locale,
          )}
        </p>
        <h2>{fillStory(WS1_COPY['pricing.faq.refunds.q'], locale)}</h2>
        <p>
          {fillStory(WS1_COPY['pricing.faq.refunds.a'], locale)}{' '}
          <Link href="/refunds">{fillStory(WS1_COPY['cancel.refundLink'], locale)}</Link>
        </p>
        {passEnabled ? (
          <>
            <h2>{fillStory(WS1_COPY['pricing.faq.passEnds.q'], locale)}</h2>
            <p>{fillStory(WS1_COPY['pricing.faq.passEnds.a'], locale)}</p>
          </>
        ) : null}
        <h2>{fillStory(WS1_COPY['pricing.faq.taxes.q'], locale)}</h2>
        <p>{fillStory(WS1_COPY['pricing.faq.taxes.a'], locale)}</p>
        <h2>{fillStory(WS1_COPY['pricing.faq.india.q'], locale)}</h2>
        <p>{indiaFaqAnswer(passEnabled, 'inr', inrPaused || !rupeePurchasesOpen)}</p>
      </section>
      <section data-testid="price-promise">
        <h2>{fillStory(WS1_COPY['pricing.promise.title'], locale)}</h2>
        {pricePromiseLines().map((line) => (
          <p key={line}>{line}</p>
        ))}
        <Link href="/pricing/changelog">
          {fillStory(WS1_COPY['pricing.promise.changelogLink'], locale)}
        </Link>
      </section>
    </div>
  );
}

function StoryCard({
  card,
  highlighted,
  onCta,
}: {
  card: {
    id: string;
    name: string;
    tagline: string;
    price: string;
    suffix: string;
    renewal: string;
    features: string[];
    cta: string;
    expand: string | null;
    paid: boolean;
  };
  highlighted: boolean;
  onCta: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canCollapse = card.expand !== null && card.features.length > COLLAPSE_AFTER;
  return (
    <article
      className="dm-tier"
      data-highlighted={highlighted ? 'true' : 'false'}
      data-plan={card.id}
    >
      <div className="dm-tier-name">
        <h2>{card.name}</h2>
      </div>
      <p className="dm-tier-job">{card.tagline}</p>
      <p className="dm-tier-price">
        <span className="dm-tier-amount">
          <span>{card.price}</span>
          {card.suffix ? <span>{card.suffix}</span> : null}
        </span>
      </p>
      <p className="dm-tier-note">{card.renewal}</p>
      <ul className="dm-tier-features" data-features={canCollapse && !open ? 'collapsed' : 'open'}>
        {card.features.map((feature) => (
          <li key={feature}>
            <CheckGlyph />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {canCollapse ? (
        <button type="button" className="dm-tier-expand" onClick={() => setOpen((value) => !value)}>
          {open ? fillStory(WS1_COPY['pricing.features.collapse']) : card.expand}
        </button>
      ) : null}
      <button
        type="button"
        className="dm-tier-cta"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onCta().finally(() => setBusy(false));
        }}
      >
        {card.cta}
      </button>
      {card.paid ? (
        <p className="dm-tier-note">
          <Link href="/refunds">{refundLine()}</Link>
        </p>
      ) : null}
    </article>
  );
}
