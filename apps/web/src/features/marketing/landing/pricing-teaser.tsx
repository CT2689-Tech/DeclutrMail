'use client';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

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
 * Client only to read the region rail (D117): these amounts must name
 * the same currency /pricing and the checkout do, or the landing page
 * quotes a price the purchase then contradicts. Still server-RENDERED,
 * so the crawler sees the numbers. Each amount clamps per price point,
 * so an unprovisioned rail shows the USD checkout would actually charge.
 */

export function PricingTeaser() {
  const provider = useRegionProvider();
  const { free, plus, pro } = TIER_MANIFEST;
  const founding = pro.promo;
  const money = (point: { usdCents: number; inrPaise: number; razorpayPlanId: string | null }) =>
    formatMoney(point, currencyForPricePoint(point, provider));

  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 07 — Pricing</p>
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
            <li>Full sender ledger + activity journal</li>
            <li>
              {free.inboxLimit} inbox · {free.undoWindowDays}-day Activity Undo for Archive, Later,
              and Delete
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
            <li>Autopilot finds matching mail; you approve each batch</li>
            <li>
              {plus.inboxLimit} inbox · {plus.undoWindowDays}-day Activity Undo for Archive, Later,
              and Delete
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
            <li>Rules run unattended · Brief · Quiet hours · Follow-ups</li>
            <li>
              {pro.inboxLimit} inboxes · {pro.undoWindowDays}-day Activity Undo for Archive, Later,
              and Delete
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
        <span>30-day money-back guarantee on every paid plan</span>
        <TrackedCta href="/pricing" cta="see_pricing" placement="pricing_teaser">
          See full pricing →
        </TrackedCta>
      </div>
    </section>
  );
}
