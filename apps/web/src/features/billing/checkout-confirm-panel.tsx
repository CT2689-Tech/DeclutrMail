'use client';

import { Button, tokens } from '@declutrmail/shared';
import {
  BRIEF_PROCESSING_NOTE,
  CHECKOUT_TOTAL_NOTE,
  RAZORPAY_LIMITATIONS_NOTE,
} from './billing-copy';
import type { BillingCycle, BillingProviderId } from '@declutrmail/shared/contracts';
import { inrNewPurchasePaused } from '@declutrmail/shared/contracts/billing-availability';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import {
  fillStory,
  priceLine as formatLaunchPrice,
  promoBanner,
  TIER_MANIFEST,
} from '@declutrmail/shared/entitlements';
import type { PricePoint } from '@declutrmail/shared/entitlements';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';
import { GroupTitle } from '@/features/settings/settings-list';
import { moneyBackNote } from './billing-model';

const { color, radius, text } = tokens;
type PaidTier = 'plus' | 'pro';

export function ConfirmPanel({
  target,
  cycle,
  provider,
  razorpayOffered,
  pricingV2 = false,
  offer = null,
  country = null,
  indiaCheckoutOpen = false,
  pricePointOverride = null,
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
  pricingV2?: boolean;
  offer?: 'pass_onetime' | null;
  country?: string | null;
  /** Public flag: both India Paddle price ids exist and geo can be signed. */
  indiaCheckoutOpen?: boolean;
  pricePointOverride?: PricePoint | null;
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
  const pricePoint = founding ? founding.annual : (pricePointOverride ?? point ?? null);
  // D226 makes this preview the truthful "here is exactly what
  // happens" step, so it must quote the currency this checkout would
  // charge. Razorpay settles INR. Under pricing v2 an India visitor
  // is quoted INR only while India checkout is open; otherwise USD.
  const currency = pricePoint
    ? currencyForPricePoint(pricePoint, provider, { pricingV2, country, indiaCheckoutOpen })
    : 'USD';
  const amountLabel =
    pricePoint && pricingV2
      ? formatLaunchPrice(pricePoint, currency === 'INR' ? 'inr' : 'usd')
      : pricePoint
        ? formatMoney(pricePoint, currency)
        : null;
  // The claim-founding label quotes a DIFFERENT price point than the one
  // `impact` describes — the promo and standard annual are separate SKUs
  // with separate Razorpay ids, so one being purchasable on a rail says
  // nothing about the other. Reusing `currency` here let an India
  // visitor read "Claim Founding Pro — ₹10,999/yr" off the standard
  // point's provisioning, tick the box, and land on a $129 charge.
  const promoCurrency = tier.promo ? currencyForPricePoint(tier.promo.annual, provider) : currency;
  const checkoutPaused = inrNewPurchasePaused(provider, currency, indiaCheckoutOpen);
  const storyLocale = currency === 'INR' ? 'inr' : 'usd';
  const launchImpact =
    offer === 'pass_onetime'
      ? fillStory(WS1_COPY['checkout.pass.summary'], storyLocale)
      : fillStory(WS1_COPY['checkout.plus.summary'], storyLocale);
  const impact = checkoutPaused
    ? `${amountLabel ? `Reference price: ${amountLabel}${pricingV2 ? '' : `/${cycle === 'annual' ? 'yr' : 'mo'}`}. ` : ''}${WS1_COPY['pricing.inrPaused.checkout']}`
    : pricingV2
      ? launchImpact
      : amountLabel !== null
        ? `${amountLabel} billed ${cycle === 'annual' ? 'annually' : 'monthly'}, starting today. Renews automatically — cancel anytime.`
        : `Pricing for the ${cycle} cycle isn’t available right now — try the other billing cycle.`;
  const promoLive = pricingV2 && promoBanner(new Date(), false) !== null;

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
      <GroupTitle as="div">
        {pricingV2 ? fillStory(WS1_COPY['checkout.title']) : 'Preview · before anything changes'}
      </GroupTitle>
      {!pricingV2 && (razorpayOffered || provider === 'razorpay') ? (
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
              disabled={!razorpayOffered}
              checked={provider === 'razorpay'}
              onChange={onProviderChange}
              title="UPI · cards · netbanking (India)"
              detail={WS1_COPY['pricing.inrPaused.button']}
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
              First {tier.promo.maxRedemptions} paid subscriptions, price locked while you stay
              subscribed. If spots run out, checkout will say so.
            </span>
          </span>
        </label>
      ) : null}

      <p style={{ margin: 0, fontSize: text.sm, color: color.fgSoft }}>{impact}</p>
      <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
        {pricingV2 ? fillStory(WS1_COPY['checkout.taxNote']) : CHECKOUT_TOTAL_NOTE}
      </p>
      {promoLive ? (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {fillStory(WS1_COPY['checkout.codeNote'])}
        </p>
      ) : null}
      {pricingV2 && currency === 'INR' ? (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {fillStory(WS1_COPY['checkout.inr'], 'inr')}
        </p>
      ) : null}
      {provider === 'razorpay' && (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {RAZORPAY_LIMITATIONS_NOTE}{' '}
          <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
            Contact support
          </a>
          .
        </p>
      )}
      {tier.id === 'pro' && (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {BRIEF_PROCESSING_NOTE}{' '}
          <a href="/privacy" style={{ color: color.primary }}>
            Privacy details
          </a>
          .
        </p>
      )}
      <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
        {moneyBackNote(pricingV2)}
      </p>

      {errorMessage != null && (
        <div
          role="alert"
          style={{
            fontSize: text.sm,
            color: color.dangerText,
            background: color.dangerBg,
            borderRadius: radius.md,
            padding: '8px 10px',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          tone="primary"
          onClick={onConfirm}
          disabled={isPending || pricePoint === null || checkoutPaused}
        >
          {checkoutPaused
            ? WS1_COPY['pricing.inrPaused.button']
            : isPending
              ? fillStory(WS1_COPY['checkout.opening'])
              : pricingV2
                ? fillStory(WS1_COPY['checkout.continue'])
                : 'Continue to checkout'}
        </Button>
        <Button tone="default" onClick={onDismiss} disabled={isPending}>
          {pricingV2 ? fillStory(WS1_COPY['checkout.back']) : 'Keep current plan'}
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
  disabled = false,
}: {
  value: BillingProviderId;
  checked: boolean;
  onChange: (provider: BillingProviderId) => void;
  title: string;
  detail: string;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span>
        <span style={{ fontWeight: 600, color: color.fg }}>{title}</span>{' '}
        <span style={{ color: color.fgMuted }}>— {detail}</span>
      </span>
    </label>
  );
}
