'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { BillingCycle, BillingProviderId } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';
import { GroupTitle } from '@/features/settings/settings-list';
import { MONEY_BACK_NOTE } from './billing-model';

const { color, radius, text } = tokens;
type PaidTier = 'plus' | 'pro';

export function ConfirmPanel({
  target,
  cycle,
  provider,
  razorpayOffered,
  onProviderChange,
  foundingEligible,
  claimFounding,
  onClaimFoundingChange,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  target: PaidTier;
  cycle: BillingCycle;
  /** The RAW regional/user rail pick, NOT the parent's clamped one —
   *  this panel quotes two different price points and each has to clamp
   *  against its own catalog id. */
  provider: BillingProviderId;
  /** Whether the price point this panel would buy has a Razorpay id —
   *  derived by the parent, which also bills with it. */
  razorpayOffered: boolean;
  onProviderChange: (provider: BillingProviderId) => void;
  foundingEligible: boolean;
  claimFounding: boolean;
  onClaimFoundingChange: (claim: boolean) => void;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const tier = TIER_MANIFEST[target];
  const point = cycle === 'annual' ? tier.prices.annual : tier.prices.monthly;
  const founding = foundingEligible && claimFounding && tier.promo ? tier.promo : null;
  // A paid tier with no price point for the chosen cycle must never
  // render a fabricated "$0.00 billed …, starting today" promise —
  // block checkout instead. Unreachable with today's manifest (both
  // paid tiers carry both cycles); guards future tier edits.
  const pricePoint = founding ? founding.annual : (point ?? null);
  // D226 makes this preview the truthful "here is exactly what
  // happens" step, so it must quote the currency the SELECTED provider
  // actually charges: Razorpay settles INR, Paddle USD, and the
  // manifest carries both as independently chosen prices. Quoting $129
  // and then charging ₹10,999 is the preview lying about the one number
  // it exists to state.
  const currency = pricePoint ? currencyForPricePoint(pricePoint, provider) : 'USD';
  // The claim-founding label quotes a DIFFERENT price point than the one
  // `impact` describes — the promo and standard annual are separate SKUs
  // with separate Razorpay ids, so one being purchasable on a rail says
  // nothing about the other. Reusing `currency` here let an India
  // visitor read "Claim Founding Pro — ₹10,999/yr" off the standard
  // point's provisioning, tick the box, and land on a $129 charge.
  const promoCurrency = tier.promo ? currencyForPricePoint(tier.promo.annual, provider) : currency;
  const impact =
    pricePoint !== null
      ? `${formatMoney(pricePoint, currency)} billed ${cycle === 'annual' ? 'annually' : 'monthly'}, starting today. Renews automatically — cancel anytime.`
      : `Pricing for the ${cycle} cycle isn't available right now — try the other billing cycle.`;

  return (
    <div
      data-testid="checkout-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 'clamp(18px, 4vw, 24px)',
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
      }}
    >
      <GroupTitle as="div">Preview · before anything changes</GroupTitle>
      {razorpayOffered ? (
        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          {/* D117 — the provider is the user's explicit regional choice. */}
          <legend style={{ fontSize: text.sm, color: color.fgMuted, padding: 0, marginBottom: 6 }}>
            How would you like to pay?
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ProviderRadio
              value="paddle"
              checked={provider === 'paddle'}
              onChange={onProviderChange}
              title="Card · PayPal · Apple Pay"
              detail="Everywhere outside India — secure checkout by Paddle"
            />
            <ProviderRadio
              value="razorpay"
              checked={provider === 'razorpay'}
              onChange={onProviderChange}
              title="UPI · cards · netbanking (India)"
              detail="Billed in INR equivalent — secure checkout by Razorpay"
            />
          </div>
        </fieldset>
      ) : null}

      {foundingEligible && tier.promo ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            fontSize: text.sm,
            color: color.fg,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={claimFounding}
            onChange={(e) => onClaimFoundingChange(e.target.checked)}
          />
          <span>
            <strong style={{ fontWeight: 600 }}>
              Claim {tier.promo.name} — {formatMoney(tier.promo.annual, promoCurrency)}/yr
            </strong>{' '}
            <span style={{ color: color.fgMuted }}>
              First {tier.promo.maxRedemptions} members, price locked while you stay subscribed. If
              spots run out, checkout will say so.
            </span>
          </span>
        </label>
      ) : null}

      <p style={{ margin: 0, fontSize: text.sm, color: color.fgSoft }}>{impact}</p>
      <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>

      {errorMessage != null && (
        <div
          role="alert"
          style={{
            fontSize: text.sm,
            color: color.danger,
            background: color.dangerBg,
            borderRadius: radius.md,
            padding: '8px 10px',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="primary" onClick={onConfirm} disabled={isPending || pricePoint === null}>
          {isPending ? 'Opening checkout…' : 'Continue to checkout'}
        </Button>
        <Button tone="default" onClick={onDismiss} disabled={isPending}>
          Keep current plan
        </Button>
      </div>
    </div>
  );
}

function ProviderRadio({
  value,
  checked,
  onChange,
  title,
  detail,
}: {
  value: BillingProviderId;
  checked: boolean;
  onChange: (provider: BillingProviderId) => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        minHeight: 48,
        boxSizing: 'border-box',
        padding: '12px 14px',
        background: checked ? color.primarySoft : color.fill,
        boxShadow: checked ? `inset 0 0 0 2px ${color.primary}` : 'none',
        borderRadius: radius.lg,
        cursor: 'pointer',
        fontSize: text.sm,
      }}
    >
      <input
        type="radio"
        name="billing-provider"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span>
        <span style={{ fontWeight: 600, color: color.fg }}>{title}</span>{' '}
        <span style={{ color: color.fgMuted }}>— {detail}</span>
      </span>
    </label>
  );
}
