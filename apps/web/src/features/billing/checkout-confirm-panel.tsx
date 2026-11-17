'use client';

import { Button, tokens } from '@declutrmail/shared';
import { BRIEF_PROCESSING_NOTE, CHECKOUT_TOTAL_NOTE } from './billing-copy';
import type { BillingCycle } from '@declutrmail/shared/contracts';
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
  pricingV2 = false,
  offer = null,
  country = null,
  indiaCheckoutOpen = false,
  pricePointOverride = null,
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
  pricingV2?: boolean;
  offer?: 'pass_onetime' | null;
  country?: string | null;
  /** Public flag: both India Paddle price ids exist and geo can be signed. */
  indiaCheckoutOpen?: boolean;
  pricePointOverride?: PricePoint | null;
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
  // charge. Under pricing v2 an India visitor is quoted INR only while
  // India checkout is open; otherwise USD.
  const currency = pricePoint
    ? currencyForPricePoint(pricePoint, { pricingV2, country, indiaCheckoutOpen })
    : 'USD';
  const amountLabel =
    pricePoint && pricingV2
      ? formatLaunchPrice(pricePoint, currency === 'INR' ? 'inr' : 'usd')
      : pricePoint
        ? formatMoney(pricePoint, currency)
        : null;
  // The claim-founding label quotes a DIFFERENT price point than the one
  // `impact` describes, so it resolves its own currency.
  const promoCurrency = tier.promo ? currencyForPricePoint(tier.promo.annual) : currency;
  const checkoutPaused = inrNewPurchasePaused(currency, indiaCheckoutOpen);
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
