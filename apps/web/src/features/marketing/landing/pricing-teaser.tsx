import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

/**
 * Pricing teaser (D134 §8) — Free / Plus / ⭐ Pro strip + Founding Pro
 * banner + money-back line, linking to /pricing for the full grid.
 *
 * Every dollar amount and limit renders FROM the D19 manifest —
 * re-pricing in packages/shared/src/entitlements/manifest.ts flows
 * here with no copy edit.
 */

function dollars(usdCents: number): string {
  return `$${usdCents % 100 === 0 ? usdCents / 100 : (usdCents / 100).toFixed(2)}`;
}

export function PricingTeaser() {
  const { free, plus, pro } = TIER_MANIFEST;
  const founding = pro.promo;

  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 05 — Pricing</p>
      <h2 className="dm-mkt-h2">Start free. Pay when it earns it.</h2>

      <div className="dm-mkt-tiers">
        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{free.name}</div>
          <div className="dm-mkt-tier-price">
            {dollars(free.prices.monthly?.usdCents ?? 0)} <small>forever</small>
          </div>
          <div className="dm-mkt-tier-alt" />
          <ul className="dm-mkt-tier-feats">
            <li>{free.cleanupActionsLifetime} cleanup actions to taste the ritual</li>
            <li>Full sender ledger + activity journal</li>
            <li>
              {free.inboxLimit} inbox · {free.undoWindowDays}-day undo
            </li>
          </ul>
        </div>

        <div className="dm-mkt-tier">
          <div className="dm-mkt-tier-name">{plus.name}</div>
          <div className="dm-mkt-tier-price">
            {plus.prices.monthly ? dollars(plus.prices.monthly.usdCents) : '—'}{' '}
            <small>/ month</small>
          </div>
          <div className="dm-mkt-tier-alt">
            {plus.prices.annual ? `or ${dollars(plus.prices.annual.usdCents)} / year` : ''}
          </div>
          <ul className="dm-mkt-tier-feats">
            <li>Unlimited cleanup actions</li>
            <li>The full Triage ritual</li>
            <li>
              {plus.inboxLimit} inbox · {plus.undoWindowDays}-day undo
            </li>
          </ul>
        </div>

        <div className="dm-mkt-tier dm-mkt-tier-flag">
          <div className="dm-mkt-tier-name">
            {pro.name} <span className="dm-mkt-tier-star">⭐ recommended</span>
          </div>
          <div className="dm-mkt-tier-price">
            {pro.prices.monthly ? dollars(pro.prices.monthly.usdCents) : '—'} <small>/ month</small>
          </div>
          <div className="dm-mkt-tier-alt">
            {pro.prices.annual ? `or ${dollars(pro.prices.annual.usdCents)} / year` : ''}
          </div>
          <ul className="dm-mkt-tier-feats">
            <li>Everything in {plus.name}, plus automation</li>
            <li>Autopilot rules, Brief, Screener</li>
            <li>
              {pro.inboxLimit} inboxes · {pro.undoWindowDays}-day undo
            </li>
          </ul>
        </div>
      </div>

      {founding ? (
        <div className="dm-mkt-founding">
          <b>{founding.name}</b>
          <span>
            {dollars(founding.annual.usdCents)} / year for the first {founding.maxRedemptions}{' '}
            members — {pro.name} features, price locked while your subscription stays active.
          </span>
        </div>
      ) : null}

      <div className="dm-mkt-pricing-foot">
        <span>30-day money-back guarantee on every paid plan</span>
        <a href="/pricing">See full pricing →</a>
      </div>
    </section>
  );
}
