'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ACTION_SAFETY_SUMMARY, OAUTH_SCOPE_DISCLOSURE, tokens } from '@declutrmail/shared';
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
import { useConsentedPageView } from '../use-consented-page-view';
import { track } from '@/lib/posthog';

const { color, font, radius, shadow } = tokens;

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
 * table → footer.
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
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px 72px' }}>
      <header style={{ padding: '48px 0 8px', maxWidth: 640 }}>
        <p
          style={{
            margin: 0,
            fontFamily: font.mono,
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: color.primary,
            fontWeight: 600,
          }}
        >
          Pricing
        </p>
        <h1
          style={{
            margin: '10px 0 0',
            fontFamily: font.display,
            fontSize: 40,
            lineHeight: 1.12,
            fontWeight: 700,
            color: color.fg,
            letterSpacing: '-0.015em',
          }}
        >
          Start free. Add automation when you need it.
        </h1>
        <p
          style={{
            margin: '14px 0 0',
            fontFamily: font.sans,
            fontSize: 15,
            lineHeight: 1.55,
            color: color.fgSoft,
          }}
        >
          Free includes every manual cleanup action, with a monthly limit. Plus removes the limit
          and adds the Screener, Autopilot rules that keep working on their own, and Quiet hours.
          Pro adds the Daily Brief, Follow-ups, and more connected inboxes. Keep, Archive,
          Unsubscribe, Later, and Delete work the same way on every plan. {ACTION_SAFETY_SUMMARY}
        </p>
      </header>

      <FoundingProBanner />

      <div style={{ display: 'flex', justifyContent: 'center', margin: '34px 0 26px' }}>
        <IntervalToggle interval={interval} onChange={setInterval} />
      </div>

      <section
        aria-label="Plans"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'stretch' }}
      >
        {cards.map((tier) => (
          <TierCard key={tier.id} tier={tier} interval={interval} highlighted={tier.id === 'pro'} />
        ))}
      </section>

      {/* Every tier CTA starts Google OAuth for a signed-out visitor
          (cta.ts routes a live session to the app instead), so the scope
          and the D228 boundary ride with the plan choice. */}
      <p
        style={{
          margin: '14px 0 0',
          fontFamily: font.mono,
          fontSize: 11,
          letterSpacing: '0.04em',
          color: color.fgMuted,
        }}
      >
        {OAUTH_SCOPE_DISCLOSURE}
      </p>

      <section
        aria-label="Team and Enterprise"
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}
      >
        {rows.map((tier) => (
          <NonPurchasableRow key={tier.id} tier={tier} />
        ))}
      </section>

      <section aria-label="Compare plans" style={{ marginTop: 56 }}>
        <h2
          style={{
            margin: '0 0 18px',
            fontFamily: font.display,
            fontSize: 24,
            fontWeight: 650,
            color: color.fg,
          }}
        >
          Compare plans
        </h2>
        <CompareTable />
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
    <aside
      aria-label={promo.name}
      style={{
        marginTop: 30,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '16px 20px',
        background: color.primaryDeep,
        borderRadius: radius.lg,
        boxShadow: shadow.lift,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <strong
          // fgInverse tracks the panel: primaryDeep is the hover-brighten
          // step, so this surface is dark teal on light and BRIGHT teal on
          // dark. Mint lettering only ever worked against the light-theme
          // version of it.
          style={{
            fontFamily: font.display,
            fontSize: 16,
            fontWeight: 650,
            color: color.fgInverse,
          }}
        >
          {promo.name} — {formatMoney(promo.annual, promoCurrency)}/yr for the first{' '}
          {promo.maxRedemptions} subscriptions
        </strong>
        <span style={{ fontFamily: font.sans, fontSize: 13, color: color.fgInverseSoft }}>
          {standardAnnual ? `Instead of ${formatMoney(standardAnnual, promoCurrency)}/yr — ` : ''}
          full {hostTier.name}, price locked while your subscription stays active. Availability is
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
        style={{
          height: 36,
          padding: '0 16px',
          fontFamily: font.sans,
          fontSize: 13.5,
          fontWeight: 700,
          // Both halves must flip with the panel. mint is bright in BOTH
          // themes, so mint-on-panel loses all contrast once the panel
          // brightens; fgInverse/primaryDeep stay anti-correlated.
          color: color.primaryDeep,
          background: busy ? color.fgInverseMuted : color.fgInverse,
          border: 'none',
          borderRadius: radius.md,
          cursor: busy ? 'wait' : 'pointer',
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
    <div
      role="group"
      aria-label="Billing interval"
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.pill,
      }}
    >
      {options.map((opt) => {
        const active = opt.id === interval;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            style={{
              height: 32,
              padding: '0 16px',
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 600,
              color: active ? color.fgInverse : color.fgSoft,
              background: active ? color.fg : 'transparent',
              border: 'none',
              borderRadius: radius.pill,
              cursor: 'pointer',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Team / Enterprise rows — which treatment renders is driven by the
 * manifest's `nonPurchasableRow.kind`, not by tier id, so the manifest
 * stays the single source of how a tier appears on this page.
 */
function NonPurchasableRow({ tier }: { tier: TierDefinition }) {
  const row = tier.nonPurchasableRow;
  if (!row) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '18px 22px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: font.display,
              fontSize: 17,
              fontWeight: 650,
              color: color.fg,
            }}
          >
            {tier.name}
          </h3>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: color.fgMuted,
              fontWeight: 600,
            }}
          >
            {row.label}
          </span>
        </div>
        <p style={{ margin: 0, fontFamily: font.sans, fontSize: 13, color: color.fgSoft }}>
          {TIER_JOBS[tier.id]}
        </p>
      </div>

      {row.kind === 'waitlist' ? (
        <WaitlistForm tierInterest={tier.id} source="pricing" />
      ) : (
        <a
          href={ENTERPRISE_CONTACT_MAILTO}
          style={{
            height: 32,
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 14px',
            fontFamily: font.sans,
            fontSize: 13,
            fontWeight: 600,
            color: color.fg,
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: radius.sm,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Contact sales
        </a>
      )}
    </div>
  );
}
