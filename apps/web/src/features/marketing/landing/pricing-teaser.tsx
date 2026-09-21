'use client';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { useRegionProvider } from '@/features/billing/billing-currency';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';

import { TrackedCta } from './tracked-cta';

/**
 * Pricing teaser (D134 §8) — Free / Plus / Pro strip, one line for Founding
 * Pro and the money-back guarantee, linking to /pricing for the full grid.
 *
 * Every amount and limit renders FROM the D19 manifest — re-pricing in
 * packages/shared/src/entitlements/pricing.config.ts flows here with no copy
 * edit.
 *
 * CURRENCY: this strip quotes USD to everyone. It reads
 * `useRegionProvider`, but `/` is a STATIC route with no provider above
 * it, so the hook returns its own default (Paddle → USD) rather than the
 * visitor's rail.
 *
 * That is deliberate, not an oversight. The previous note here said
 * these amounts "must name the same currency /pricing and the checkout
 * do" — true as a goal, but it was traded away knowingly: sourcing the
 * rail requires a per-request read, a per-request read makes the route
 * dynamic, and a dynamic route in Next defers every `<head>` tag past
 * `</head>`, so declutrmail.com shared to X/LinkedIn/Slack rendered a
 * blank card. See `app/(marketing)/page.tsx` for the measurement.
 *
 * The guarantee that actually matters still holds: nobody is charged a
 * price they were not shown AT THE POINT OF SALE. `/pricing` quotes the
 * visitor's rail, `/billing` reads geo server-side, and checkout charges
 * what it displays. This strip is a teaser that links to that grid.
 */

export function PricingTeaser() {
  const provider = useRegionProvider();
  const { free, plus, pro } = TIER_MANIFEST;
  const founding = pro.promo;
  const money = (point: { usdCents: number; inrPaise: number; razorpayPlanId: string | null }) =>
    formatMoney(point, currencyForPricePoint(point, provider));

  return (
    <section className="dm-mkt-section dm-mkt-shell dm-mkt-center">
      <h2 className="dm-mkt-h2">Start free. Pay when it earns it.</h2>

      {/* A teaser: name, price, the one line that separates the tier from
          the one before it. The full grid — annual prices, Quiet hours, the
          undo window — is /pricing's job. */}
      <div className="dm-mkt-tiers">
        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{free.name}</div>
          <div className="dm-mkt-tier-price">
            {free.prices.monthly ? money(free.prices.monthly) : null}
          </div>
          <p className="dm-mkt-tier-line">
            {free.cleanupActionsPerMonth} cleanup actions every month
          </p>
        </div>

        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{plus.name}</div>
          <div className="dm-mkt-tier-price">
            {plus.prices.monthly ? money(plus.prices.monthly) : '—'} <small>/ month</small>
          </div>
          <p className="dm-mkt-tier-line">
            Unlimited cleanup actions, Screener, and Autopilot rules
          </p>
        </div>

        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{pro.name}</div>
          <div className="dm-mkt-tier-price">
            {pro.prices.monthly ? money(pro.prices.monthly) : '—'} <small>/ month</small>
          </div>
          <p className="dm-mkt-tier-line">
            Everything in {plus.name}, Daily Brief, Follow-ups, and {pro.inboxLimit} inboxes
          </p>
        </div>
      </div>

      <p className="dm-mkt-pricing-foot">
        {founding
          ? `${founding.name}: ${money(founding.annual)} / year, limited to the first ${founding.maxRedemptions} paid subscriptions. `
          : ''}
        30-day money-back guarantee on every paid plan.
      </p>
      <TrackedCta
        href="/pricing"
        cta="see_pricing"
        placement="pricing_teaser"
        className="dm-mkt-cta-link"
      >
        See full pricing <span aria-hidden="true">→</span>
      </TrackedCta>
    </section>
  );
}
