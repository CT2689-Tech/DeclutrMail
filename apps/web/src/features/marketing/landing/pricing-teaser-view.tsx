import type { BillingProviderId } from '@declutrmail/shared/contracts';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, refundLine, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import {
  currencyForPricePoint,
  formatMoney,
  TIER_JOBS,
  sharedAnnualMonthsFree,
} from '@/features/marketing/pricing/pricing-model';
import { TrackedCta } from './tracked-cta';

/**
 * Server-capable presentation of the pre-launch catalog; the caller
 * supplies the display rail. Shares the launch teaser's card layout.
 */
export function PricingTeaserView({ provider }: { provider: BillingProviderId }) {
  const { free, plus, pro } = TIER_MANIFEST;
  const founding = pro.promo;
  const annualMonthsFree = sharedAnnualMonthsFree(provider);
  const money = (point: { usdCents: number; inrPaise: number; razorpayPlanId: string | null }) =>
    formatMoney(point, currencyForPricePoint(point, provider));
  const plans = [
    {
      id: 'free',
      name: free.name,
      job: TIER_JOBS.free,
      price: free.prices.monthly ? money(free.prices.monthly) : '',
      terms: '',
      features: [
        fillStory(WS1_COPY['pricing.free.features'][0]),
        'Sender detail and live action previews',
        `${free.inboxLimit} connected inbox`,
      ],
    },
    {
      id: 'plus',
      name: plus.name,
      job: TIER_JOBS.plus,
      price: plus.prices.monthly ? money(plus.prices.monthly) : '—',
      terms: '/ month',
      features: [
        WS1_COPY['pricing.plus.features'][0],
        'Screener and Autopilot rules',
        'Quiet hours',
      ],
    },
    {
      id: 'pro',
      name: pro.name,
      job: TIER_JOBS.pro,
      price: pro.prices.monthly ? money(pro.prices.monthly) : '—',
      terms: '/ month',
      features: [
        `Everything in ${plus.name}`,
        'Daily Brief and Follow-ups',
        `${pro.inboxLimit} connected Gmail accounts`,
      ],
    },
  ];

  return (
    <section
      id="plans"
      className="dm-home-section dm-home-pricing dm-mkt-shell"
      aria-labelledby="dm-home-pricing-title"
    >
      <div className="dm-home-head">
        <p className="dm-home-kicker">Plans &amp; pricing</p>
        <h2 id="dm-home-pricing-title" className="dm-home-h2">
          Start free. <em>Pay when it earns it.</em>
        </h2>
        <p className="dm-home-lede">
          Every plan starts with sender review and a preview before mail moves. Choose a plan for
          how often you want DeclutrMail to help.
        </p>
      </div>
      <div className="dm-home-plans" data-count={plans.length}>
        {plans.map((plan) => (
          <article key={plan.id} className="dm-home-plan">
            <div className="dm-home-plan-head">
              <h3>{plan.name}</h3>
              <span>{plan.job}</span>
            </div>
            <p className="dm-home-plan-price">
              <span className="dm-home-num">{plan.price}</span>
              {plan.terms ? (
                <>
                  {' '}
                  <span>{plan.terms}</span>
                </>
              ) : null}
            </p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="dm-mkt-pricing-foot dm-home-pricing-foot">
        <span>{refundLine()}</span>
        <TrackedCta
          href="/pricing"
          cta="see_pricing"
          placement="pricing_teaser"
          className="dm-home-text-link"
        >
          See full pricing <span aria-hidden="true">→</span>
        </TrackedCta>
        <details>
          <summary>Annual billing, currency and Founding Pro</summary>
          <p>
            {founding
              ? `${founding.name}: ${money(founding.annual)} / year, limited to the first ${founding.maxRedemptions} paid subscriptions. `
              : ''}
            Monthly prices shown in {provider === 'paddle' ? 'USD' : 'INR'}; local pricing, where
            available, appears on the full pricing page.
            {annualMonthsFree !== null
              ? ` Annual billing saves ${annualMonthsFree} months on standard paid plans.`
              : ' Annual plans are also available.'}
          </p>
        </details>
      </div>
    </section>
  );
}
