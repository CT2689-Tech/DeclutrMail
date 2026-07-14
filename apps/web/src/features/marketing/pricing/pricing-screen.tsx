'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ACTION_SAFETY_SUMMARY, tokens } from '@declutrmail/shared';
import type { TierDefinition } from '@declutrmail/shared/entitlements';

import { navigateToCheckout } from './cta';
import {
  foundingProPromo,
  formatUsd,
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

// Enterprise row contact (D19 "Contact sales"). NOTE for the founder:
// inbound routing for this address must exist before launch — swap here
// if a different sales address is chosen.
const ENTERPRISE_CONTACT_MAILTO = 'mailto:hello@declutrmail.com?subject=DeclutrMail%20Enterprise';

export function PricingScreen() {
  const [interval, setInterval] = useState<BillingInterval>('monthly');

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
          Pick how clean you want to stay.
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
          Free shows you what’s noisy. Plus adds unlimited manual actions. Pro adds explicit
          Autopilot rules for recurring mail. Keep, Archive, Unsubscribe, Later, and Delete keep the
          same meaning on every plan. {ACTION_SAFETY_SUMMARY}
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
  const found = foundingProPromo();
  if (!found) return null;
  const { hostTier, promo } = found;
  const standardAnnual = hostTier.prices.annual;

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
          style={{ fontFamily: font.display, fontSize: 16, fontWeight: 650, color: color.mint }}
        >
          {promo.name} — {formatUsd(promo.annual.usdCents)}/yr for the first {promo.maxRedemptions}{' '}
          subscriptions
        </strong>
        <span style={{ fontFamily: font.sans, fontSize: 13, color: color.fgInverseSoft }}>
          {standardAnnual ? `Instead of ${formatUsd(standardAnnual.usdCents)}/yr — ` : ''}
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
          color: color.primaryDeep,
          background: busy ? color.fgInverseMuted : color.mint,
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
              color: active ? '#FFFFFF' : color.fgSoft,
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
