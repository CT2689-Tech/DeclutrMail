'use client';

import { TIER_MANIFEST, UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import { useRegionProvider } from '@/features/billing/billing-currency';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';

import { TrackedCta } from './tracked-cta';

/**
 * Pricing teaser (D134 §8) — Free / Plus / ⭐ Pro strip + Founding Pro
 * banner + money-back line, linking to /pricing for the full grid.
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

  // The undo sentence was rendering verbatim inside all three tier rows,
  // identical every time — three copies of a line that distinguishes no
  // tier from any other. While `UNIFORM_UNDO_WINDOW_DAYS` is a number the
  // ladder genuinely agrees, so it states once under the grid. If a future
  // packaging change re-splits the window the constant goes `null` and each
  // tier states its own again: the copy follows the manifest rather than
  // freezing today's answer into a hoisted line that would quietly lie.
  const perTierUndo = (days: number) =>
    UNIFORM_UNDO_WINDOW_DAYS === null
      ? ` · ${days}-day Activity Undo for Archive, Later, and Delete`
      : '';

  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 05 — Pricing</p>
      <h2 className="dm-mkt-h2">Start free. Pay when it earns it.</h2>

      <div className="dm-mkt-tiers">
        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{free.name}</div>
          <div className="dm-mkt-tier-price">
            {free.prices.monthly ? money(free.prices.monthly) : null} <small>forever</small>
          </div>
          <div className="dm-mkt-tier-alt" />
          <ul className="dm-mkt-tier-feats">
            <li>{free.cleanupActionsPerMonth} cleanup actions every month</li>
            <li>Every sender listed, and a record of everything you did</li>
            <li>
              {free.inboxLimit} inbox
              {perTierUndo(free.undoWindowDays)}
            </li>
          </ul>
        </div>

        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{plus.name}</div>
          <div className="dm-mkt-tier-price">
            {plus.prices.monthly ? money(plus.prices.monthly) : '—'} <small>/ month</small>
          </div>
          <div className="dm-mkt-tier-alt">
            {plus.prices.annual ? `or ${money(plus.prices.annual)} / year` : ''}
          </div>
          <ul className="dm-mkt-tier-feats">
            <li>Unlimited cleanup actions — everything in Free, without the monthly cap</li>
            <li>Screener collects first-time senders for your review</li>
            <li>Autopilot rules that keep working on their own · Quiet hours</li>
            <li>
              {plus.inboxLimit} inbox
              {perTierUndo(plus.undoWindowDays)}
            </li>
          </ul>
        </div>

        <div className="dm-mkt-tier dm-mkt-tier-flag">
          <div className="dm-mkt-tier-name">
            {pro.name} <span className="dm-mkt-tier-star">⭐ recommended</span>
          </div>
          <div className="dm-mkt-tier-price">
            {pro.prices.monthly ? money(pro.prices.monthly) : '—'} <small>/ month</small>
          </div>
          <div className="dm-mkt-tier-alt">
            {pro.prices.annual ? `or ${money(pro.prices.annual)} / year` : ''}
          </div>
          <ul className="dm-mkt-tier-feats">
            <li>Everything in {plus.name}</li>
            <li>Daily Brief · Follow-ups</li>
            <li>
              {pro.inboxLimit} inboxes
              {perTierUndo(pro.undoWindowDays)}
            </li>
          </ul>
        </div>
      </div>

      {founding ? (
        <div className="dm-mkt-founding">
          <b>{founding.name}</b>
          <span>
            {money(founding.annual)} / year, limited to the first {founding.maxRedemptions} paid
            subscriptions. Availability is confirmed at checkout; the price stays locked while an
            eligible subscription remains active.
          </span>
        </div>
      ) : null}

      <div className="dm-mkt-pricing-foot">
        <span>
          {UNIFORM_UNDO_WINDOW_DAYS === null
            ? ''
            : `${UNIFORM_UNDO_WINDOW_DAYS}-day Activity Undo for Archive, Later, and Delete on every plan · `}
          30-day money-back guarantee on every paid plan
        </span>
        <TrackedCta href="/pricing" cta="see_pricing" placement="pricing_teaser">
          See full pricing →
        </TrackedCta>
      </div>
    </section>
  );
}
