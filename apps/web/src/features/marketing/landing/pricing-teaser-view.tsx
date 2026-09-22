import type { BillingProviderId } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';
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
        See full pricing
      </TrackedCta>
    </section>
  );
}
