'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ACTION_SAFETY_SUMMARY, OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';
import type { TierDefinition } from '@declutrmail/shared/entitlements';

import { useRegionProvider } from '@/features/billing/billing-currency';
import { navigateToCheckout } from './cta';
import {
  currencyForPricePoint,
  foundingProPromo,
  formatMoney,
  pricingTiers,
  TIER_JOBS,
  type BillingInterval,
} from './pricing-model';
import { CompareTable } from './compare-table';
import { TierCard } from './tier-card';
import { WaitlistForm } from './waitlist-form';
import { FAQ_ENTRIES } from '../learn/faq-content';
import { useConsentedPageView } from '../use-consented-page-view';
import { track } from '@/lib/posthog';

// The shared safety summary, one fact per line. Split, never reworded:
// the sentence text stays the shared constant's.
const SAFETY_FACTS = ACTION_SAFETY_SUMMARY.split(/(?<=\.)\s+/);

// The refund line is the FAQ's own first sentence, so /pricing and /faq
// cannot drift apart. A missing entry fails loudly at import.
const REFUND_FACT = (() => {
  const entry = FAQ_ENTRIES.find((faq) => faq.id === 'refunds-support');
  if (!entry) throw new Error('faq-content: refunds-support entry is missing');
  return entry.answer.split(/(?<=\.)\s+/)[0];
})();

/**
 * /pricing (D17 pricing leg; ladder per D19, verbs per D20/D227,
 * engine framing per D21).
 *
 * Public marketing surface — renders with NO AuthProvider (D134). The
 * five tiers, every price, limit, capability and the Founding Pro promo
 * all derive from `TIER_MANIFEST` (packages/shared/src/entitlements)
 * through the pricing model: a manifest re-price re-prices this page.
 *
 * Layout: nav → hero → Founding Pro banner → interval toggle →
 * purchasable-tier cards → non-purchasable rows (Team waitlist /
 * Enterprise contact, driven by `nonPurchasableRow.kind`) → comparison
 * table → "Good to know" facts → footer. Styles: ./pricing.css.
 */

// Enterprise row contact (D19 "Contact sales").
//
// support@, not a separate hello@ (founder decision 2026-08-14). The apex
// now has Google Workspace MX, so an unaliased address would ACCEPT
// enterprise mail and drop it silently — worse than bouncing. support@ is
// the address /contact already publishes and the one that has been
// delivery-tested, so this adds no surface that is not already verified.
const ENTERPRISE_CONTACT_MAILTO = 'mailto:support@declutrmail.com?subject=DeclutrMail%20Enterprise';

export function PricingScreen() {
  // Annual by default (founder-locked 2026-08-02). The annual price is
  // the one the tier ladder is designed around — two months free — so
  // opening on monthly quoted the worse number first.
  const [interval, setInterval] = useState<BillingInterval>('annual');

  useConsentedPageView('pricing');

  const tiers = pricingTiers();
  const cards = tiers.filter((tier) => tier.purchasable);
  const rows = tiers.filter((tier) => !tier.purchasable);

  return (
    <div className="dm-pricing">
      <header className="dm-pricing-head">
        <h1>Start free. Add automation when you need it.</h1>
        <p>Every plan gets the same Keep, Archive, Unsubscribe, Later, and Delete.</p>
      </header>

      <FoundingProBanner />

      <div className="dm-pricing-toggle-wrap">
        <IntervalToggle interval={interval} onChange={setInterval} />
      </div>

      <section aria-label="Plans" className="dm-pricing-tiers">
        {cards.map((tier) => (
          <TierCard key={tier.id} tier={tier} interval={interval} highlighted={tier.id === 'pro'} />
        ))}
      </section>

      {/* Every tier CTA starts Google OAuth for a signed-out visitor
          (cta.ts routes a live session to the app instead), so the scope
          and the D228 boundary ride with the plan choice. */}
      <p className="dm-pricing-oauth">
        {OAUTH_SCOPE_DISCLOSURE} <a href="/sign-in">Review Gmail permissions</a>
      </p>

      <section aria-label="Team and Enterprise" className="dm-pricing-more">
        {rows.map((tier) => (
          <NonPurchasableRow key={tier.id} tier={tier} />
        ))}
      </section>

      <section aria-label="Compare plans" className="dm-pricing-section">
        <h2>Compare plans</h2>
        <CompareTable />
      </section>

      <section aria-labelledby="dm-pricing-facts-title" className="dm-pricing-section">
        <h2 id="dm-pricing-facts-title">Good to know</h2>
        <ul className="dm-pricing-facts">
          {/* Every line below is existing copy, re-laid out from the old
              hero paragraph and the FAQ — no new claims. */}
          <li>
            Free includes every manual cleanup action, capped monthly. Reaching the cap pauses
            Archive, Unsubscribe, Later, and Delete until the next month or an upgrade; Keep always
            keeps working.
          </li>
          {SAFETY_FACTS.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
          <li>
            {REFUND_FACT} <a href="/refunds">Read the refund policy</a>
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * D19 launch offer strip. Renders only while the manifest carries a
 * promo — delete `pro.promo` from the manifest and this disappears.
 */
function FoundingProBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The promo and the standard annual it is compared against are
  // SEPARATE price points with separate catalog ids — each clamps
  // against its own, so "₹10,999 instead of $190" can never render.
  const regionProvider = useRegionProvider();
  const found = foundingProPromo();
  if (!found) return null;
  const { hostTier, promo } = found;
  const standardAnnual = hostTier.prices.annual;
  const promoCurrency = currencyForPricePoint(promo.annual, regionProvider);

  return (
    <aside aria-label={promo.name} className="dm-pricing-promo">
      <div className="dm-pricing-promo-copy">
        <strong>
          {promo.name} — {formatMoney(promo.annual, promoCurrency)}/yr for the first{' '}
          {promo.maxRedemptions} subscriptions
        </strong>
        <span>
          {standardAnnual ? `Instead of ${formatMoney(standardAnnual, promoCurrency)}/yr. ` : ''}
          Full {hostTier.name}, price locked while your subscription stays active. Availability is
          confirmed at checkout; no spot is reserved until payment succeeds.
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void track('pricing_plan_selected', {
            tier: 'pro',
            cycle: 'annual',
            promo: 'foundingPro',
          });
          void navigateToCheckout((path) => router.push(path), {
            plan: 'pro',
            cycle: 'annual',
            promo: 'foundingPro',
          }).finally(() => setBusy(false));
        }}
      >
        {busy ? 'One moment…' : 'Check availability'}
      </button>
    </aside>
  );
}

function IntervalToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  const options: { id: BillingInterval; label: string }[] = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'annual', label: 'Annual — 2 months free' },
  ];
  return (
    <div role="group" aria-label="Billing interval" className="dm-pricing-toggle">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          aria-pressed={opt.id === interval}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Team / Enterprise columns — which treatment renders is driven by the
 * manifest's `nonPurchasableRow.kind`, not by tier id, so the manifest
 * stays the single source of how a tier appears on this page.
 */
function NonPurchasableRow({ tier }: { tier: TierDefinition }) {
  const row = tier.nonPurchasableRow;
  if (!row) return null;

  return (
    <div>
      <div>
        <h3>{tier.name}</h3>
        <p>{TIER_JOBS[tier.id]}</p>
      </div>
      {row.kind === 'waitlist' ? (
        <WaitlistForm tierInterest={tier.id} source="pricing" />
      ) : (
        <a href={ENTERPRISE_CONTACT_MAILTO} className="dm-pricing-contact">
          Contact sales
        </a>
      )}
    </div>
  );
}
