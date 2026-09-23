import type { BillingProviderId } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import {
  currencyForPricePoint,
  formatMoney,
  TIER_JOBS,
} from '@/features/marketing/pricing/pricing-model';
import { TrackedCta } from './tracked-cta';

/** Server-capable presentation; the caller supplies the display rail. */
export function PricingTeaserView({ provider }: { provider: BillingProviderId }) {
  const { free, plus, pro } = TIER_MANIFEST;
  const founding = pro.promo;
  const money = (point: { usdCents: number; inrPaise: number; razorpayPlanId: string | null }) =>
    formatMoney(point, currencyForPricePoint(point, provider));

  return (
    <section className="dm-mkt-section dm-mkt-shell dm-mkt-center dm-mkt-pricing">
      <h2 className="dm-mkt-h2">Start free. Pay when it earns it.</h2>

      <p className="dm-mkt-lede">
        Every plan starts with sender review and a preview before mail moves. Choose a plan for how
        often you want DeclutrMail to help.
      </p>
      <div className="dm-mkt-tiers">
        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{free.name}</div>
          <p className="dm-mkt-tier-job">{TIER_JOBS.free}</p>
          <div className="dm-mkt-tier-price">
            {free.prices.monthly ? money(free.prices.monthly) : null}
          </div>
          <ul className="dm-mkt-tier-features">
            <li>{free.cleanupActionsPerMonth} cleanup actions every month</li>
            <li>Sender detail and live action previews</li>
            <li>{free.inboxLimit} connected inbox</li>
          </ul>
        </div>

        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{plus.name}</div>
          <p className="dm-mkt-tier-job">{TIER_JOBS.plus}</p>
          <div className="dm-mkt-tier-price">
            {plus.prices.monthly ? money(plus.prices.monthly) : '—'} <small>/ month</small>
          </div>
          <ul className="dm-mkt-tier-features">
            <li>Unlimited cleanup actions</li>
            <li>Screener and Autopilot rules</li>
            <li>Quiet hours</li>
          </ul>
        </div>

        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{pro.name}</div>
          <p className="dm-mkt-tier-job">{TIER_JOBS.pro}</p>
          <div className="dm-mkt-tier-price">
            {pro.prices.monthly ? money(pro.prices.monthly) : '—'} <small>/ month</small>
          </div>
          <ul className="dm-mkt-tier-features">
            <li>Everything in {plus.name}</li>
            <li>Daily Brief and Follow-ups</li>
            <li>{pro.inboxLimit} connected inboxes</li>
          </ul>
        </div>
      </div>

      <p className="dm-mkt-pricing-foot">
        {founding
          ? `${founding.name}: ${money(founding.annual)} / year, limited to the first ${founding.maxRedemptions} paid subscriptions. `
          : ''}
        Monthly prices shown in {provider === 'paddle' ? 'USD' : 'INR'}; local pricing, where
        available, appears on the full pricing page. Annual billing saves two months on standard
        paid plans. 30-day money-back guarantee on every paid plan.
      </p>
      <TrackedCta
        href="/pricing"
        cta="see_pricing"
        placement="pricing_teaser"
        className="dm-mkt-cta-link"
      >
        See full pricing
      </TrackedCta>
    </section>
  );
}
