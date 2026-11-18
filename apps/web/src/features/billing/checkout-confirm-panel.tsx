'use client';

import { Button, tokens } from '@declutrmail/shared';
import { BRIEF_PROCESSING_NOTE, RAZORPAY_LIMITATIONS_NOTE } from './billing-copy';
import type { BillingProviderId } from '@declutrmail/shared/contracts';
import { inrNewPurchasePaused } from '@declutrmail/shared/contracts/billing-availability';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import {
  fillStory,
  priceLine as formatLaunchPrice,
  promoBanner,
} from '@declutrmail/shared/entitlements';
import type { PricePoint } from '@declutrmail/shared/entitlements';
import { currencyForPricePoint } from '@/features/marketing/pricing/pricing-model';
import { GroupTitle } from '@/features/settings/settings-list';
import { MONEY_BACK_NOTE } from './billing-model';

const { color, radius, text } = tokens;
type PaidTier = 'plus' | 'pro';

export function ConfirmPanel({
  target,
  provider,
  offer = null,
  country = null,
  indiaCheckoutOpen = false,
  pricePoint,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  target: PaidTier;
  /** The RAW regional/user rail pick, NOT the parent's clamped one —
   *  the price point clamps against its own catalog id. */
  provider: BillingProviderId;
  offer?: 'pass_onetime' | null;
  country?: string | null;
  /** Public flag: both India Paddle price ids exist and geo can be signed. */
  indiaCheckoutOpen?: boolean;
  /** The launch price point this checkout buys (Plus annual or the Pass). */
  pricePoint: PricePoint;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  // D226 makes this preview the truthful "here is exactly what
  // happens" step, so it must quote the currency this checkout would
  // charge. An India visitor is quoted INR only while India checkout is
  // open; otherwise USD.
  const currency = currencyForPricePoint(pricePoint, provider, { country, indiaCheckoutOpen });
  const amountLabel = formatLaunchPrice(pricePoint, currency === 'INR' ? 'inr' : 'usd');
  const checkoutPaused = inrNewPurchasePaused(provider, currency, indiaCheckoutOpen);
  const storyLocale = currency === 'INR' ? 'inr' : 'usd';
  const launchImpact =
    offer === 'pass_onetime'
      ? fillStory(WS1_COPY['checkout.pass.summary'], storyLocale)
      : fillStory(WS1_COPY['checkout.plus.summary'], storyLocale);
  const impact = checkoutPaused
    ? `Reference price: ${amountLabel}. ${WS1_COPY['pricing.inrPaused.checkout']}`
    : launchImpact;
  const promoLive = promoBanner(new Date(), false) !== null;

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
      <GroupTitle as="div">{fillStory(WS1_COPY['checkout.title'])}</GroupTitle>

      <p style={{ margin: 0, fontSize: text.sm, color: color.fgSoft }}>{impact}</p>
      <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
        {fillStory(WS1_COPY['checkout.taxNote'])}
      </p>
      {promoLive ? (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {fillStory(WS1_COPY['checkout.codeNote'])}
        </p>
      ) : null}
      {currency === 'INR' ? (
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
      {target === 'pro' && (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {BRIEF_PROCESSING_NOTE}{' '}
          <a href="/privacy" style={{ color: color.primary }}>
            Privacy details
          </a>
          .
        </p>
      )}
      <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>

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
        <Button tone="primary" onClick={onConfirm} disabled={isPending || checkoutPaused}>
          {checkoutPaused
            ? WS1_COPY['pricing.inrPaused.button']
            : isPending
              ? fillStory(WS1_COPY['checkout.opening'])
              : fillStory(WS1_COPY['checkout.continue'])}
        </Button>
        <Button tone="default" onClick={onDismiss} disabled={isPending}>
          {fillStory(WS1_COPY['checkout.back'])}
        </Button>
      </div>
    </div>
  );
}
