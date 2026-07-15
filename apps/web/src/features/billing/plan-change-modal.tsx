'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button, Eyebrow, tokens, useFocusTrap } from '@declutrmail/shared';
import { ERROR_CODES, isErrorCode } from '@declutrmail/shared/contracts';
import type { BillingCycle, BillingProviderId } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { formatUsd, priceLineFor, TIER_JOBS } from '@/features/marketing/pricing/pricing-model';
import { track } from '@/lib/posthog';

import { apiErrorCode } from './api/use-billing-subscription';
import type { BillingIntent } from './billing-intent';
import { useCheckout } from './api/use-checkout';
import {
  formatBillingDate,
  MONEY_BACK_NOTE,
  STRIP_TIER_IDS,
  type StripTierId,
} from './billing-model';
import { launchCheckout } from './checkout';

const { color, font, radius } = tokens;

/** Self-serve checkout targets (D19) — mirrors `PurchasableTierSchema`. */
type PaidTier = 'plus' | 'pro';

/**
 * Plan-change modal (D120).
 *
 * Three cards (Free / Plus / Pro) + a monthly/annual toggle, then the
 * impact panel for the selected target:
 *
 *   - Paid target, no active subscription → the real checkout: provider
 *     pick (D117 Paddle international / Razorpay India), Founding Pro
 *     claim when Pro-annual (D126), impact summary, continue → the
 *     provider surface via `launchCheckout`.
 *   - Free target while subscribed → D120 downgrade copy (features stay
 *     until period end; the 30-day money-back guarantee lives one step
 *     on) routing to the cancel flow — cancel IS the downgrade-to-free
 *     mechanism (the BE has no separate path).
 *   - Paid target while already subscribed → the honest designed state:
 *     paid-to-paid switching is not self-serve at beta (no BE endpoint;
 *     checkout would 409 SUBSCRIPTION_EXISTS).
 *
 * Errors render inline from the shared ERROR_CODES vocabulary —
 * BILLING_DISABLED / BILLING_NOT_PROVISIONED (billing dark, F-queue),
 * FOUNDING_PRO_SOLD_OUT, SUBSCRIPTION_EXISTS — never a generic toast.
 */
export function PlanChangeModal({
  open,
  initialIntent = null,
  currentTier,
  hasActiveSubscription,
  currentPeriodEnd,
  onClose,
  onRequestCancel,
}: {
  open: boolean;
  /** Validated pricing-page choice carried through auth/onboarding. */
  initialIntent?: BillingIntent | null;
  currentTier: TierId;
  hasActiveSubscription: boolean;
  /** ISO period end of the active subscription (downgrade copy). */
  currentPeriodEnd: string | null;
  onClose: () => void;
  /** Route to the cancel confirm (the downgrade-to-free path, D120). */
  onRequestCancel: () => void;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(initialIntent?.cycle ?? 'annual');
  const [selected, setSelected] = useState<StripTierId | null>(initialIntent?.plan ?? null);
  const [provider, setProvider] = useState<BillingProviderId>('paddle');
  const [claimFounding, setClaimFounding] = useState(
    initialIntent ? initialIntent.promo === 'foundingPro' : true,
  );
  const checkout = useCheckout();

  useEffect(() => {
    if (!open) return;
    setSelected(initialIntent?.plan ?? null);
    setCycle(initialIntent?.cycle ?? 'annual');
    setProvider('paddle');
    setClaimFounding(initialIntent ? initialIntent.promo === 'foundingPro' : true);
    checkout.reset();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Deliberately keyed on open/close only — `checkout.reset` is
    // stable across renders (TanStack result identity churns).
  }, [initialIntent, open, onClose]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  const foundingEligible = selected === 'pro' && cycle === 'annual';
  const founding = foundingEligible && claimFounding;
  const errorMessage = checkoutErrorMessage(checkout.error);

  function onContinue(target: PaidTier) {
    if (checkout.isPending) return;
    void track('checkout_started', {
      tier: target,
      cycle,
      provider,
      founding_pro: founding,
    });
    checkout.mutate(
      { tierId: target, cycle, provider, ...(founding ? { promo: 'foundingPro' as const } : {}) },
      {
        onSuccess: (session) => {
          void launchCheckout(session).then(
            // Paddle overlay is now on top of the page (Razorpay
            // navigated away) — close our modal underneath it.
            () => onClose(),
            // Provider script failed to load — keep the modal open
            // with an honest retryable message.
            () => checkout.reset(),
          );
        },
      },
    );
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-plan-change-title"
        data-testid="plan-change-modal"
        style={{
          position: 'fixed',
          top: '10vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(620px, calc(100vw - 32px))',
          maxHeight: '80vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: `1px solid ${color.line}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <Eyebrow>Change plan</Eyebrow>
            <h2
              id="dm-plan-change-title"
              style={{
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: '-0.014em',
                margin: '6px 0 0',
              }}
            >
              Pick your plan
            </h2>
          </div>
          <CycleToggle cycle={cycle} onChange={setCycle} />
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {STRIP_TIER_IDS.map((id) => (
              <PlanOptionCard
                key={id}
                tierId={id}
                cycle={cycle}
                isCurrent={id === currentTier}
                isSelected={id === selected}
                onSelect={() => setSelected(id)}
              />
            ))}
          </div>

          {selected !== null && selected !== currentTier ? (
            selected === 'free' ? (
              hasActiveSubscription ? (
                <DowngradePanel
                  currentTier={currentTier}
                  currentPeriodEnd={currentPeriodEnd}
                  onRequestCancel={() => {
                    onClose();
                    onRequestCancel();
                  }}
                />
              ) : null
            ) : hasActiveSubscription ? (
              <PaidSwitchPanel />
            ) : (
              <CheckoutPanel
                target={selected}
                cycle={cycle}
                provider={provider}
                onProviderChange={setProvider}
                foundingEligible={foundingEligible}
                claimFounding={claimFounding}
                onClaimFoundingChange={setClaimFounding}
                isPending={checkout.isPending}
                errorMessage={errorMessage}
                onContinue={() => onContinue(selected)}
              />
            )
          ) : null}

          <Link
            href="/pricing"
            style={{ fontSize: 12.5, color: color.primary, textDecoration: 'none' }}
          >
            See the full comparison →
          </Link>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 24px 16px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <Button tone="default" onClick={onClose} ariaLabel="Keep current plan">
            Keep current plan
          </Button>
        </div>
      </div>
    </>
  );
}

/** Map a checkout failure to its honest inline message. */
export function checkoutErrorMessage(error: unknown): string | null {
  if (!error) return null;
  const code = apiErrorCode(error);
  if (code !== null && isErrorCode(code)) {
    if (code === 'BILLING_DISABLED') {
      return 'Billing isn’t switched on yet — checkout opens here once it goes live.';
    }
    return ERROR_CODES[code].message;
  }
  return 'Checkout could not be started. Please try again.';
}

function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Billing interval"
      style={{
        display: 'inline-flex',
        background: color.paper,
        border: `1px solid ${color.border}`,
        borderRadius: radius.pill,
        padding: 2,
      }}
    >
      {(['monthly', 'annual'] as const).map((value) => {
        const on = cycle === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(value)}
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '4px 12px',
              borderRadius: radius.pill,
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 600,
              background: on ? color.primary : 'transparent',
              color: on ? '#FFFFFF' : color.fgSoft,
            }}
          >
            {value === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        );
      })}
    </div>
  );
}

function PlanOptionCard({
  tierId,
  cycle,
  isCurrent,
  isSelected,
  onSelect,
}: {
  tierId: TierId;
  cycle: BillingCycle;
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const tier = TIER_MANIFEST[tierId];
  const price = priceLineFor(tier, cycle);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      data-testid={`plan-option-${tierId}`}
      style={{
        flex: 1,
        textAlign: 'left',
        padding: '12px 14px',
        background: isSelected ? color.primarySoft : color.paper,
        border: `1px solid ${isSelected ? color.primaryBorder : color.line}`,
        borderRadius: radius.md,
        cursor: 'pointer',
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 650, color: color.fg }}>{tier.name}</span>
        {isCurrent ? (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: color.fgMuted,
              background: color.mutedBg,
              borderRadius: radius.pill,
              padding: '2px 7px',
            }}
          >
            Current
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: 13, color: color.fg, fontVariantNumeric: 'tabular-nums' }}>
        {price ? `${price.amount}${price.per}` : '—'}
        {price?.note ? (
          <span style={{ color: color.fgMuted, fontSize: 11.5 }}> · {price.note}</span>
        ) : null}
      </span>
      <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.4 }}>
        {TIER_JOBS[tierId]}
      </span>
    </button>
  );
}

function CheckoutPanel({
  target,
  cycle,
  provider,
  onProviderChange,
  foundingEligible,
  claimFounding,
  onClaimFoundingChange,
  isPending,
  errorMessage,
  onContinue,
}: {
  target: PaidTier;
  cycle: BillingCycle;
  provider: BillingProviderId;
  onProviderChange: (provider: BillingProviderId) => void;
  foundingEligible: boolean;
  claimFounding: boolean;
  onClaimFoundingChange: (claim: boolean) => void;
  isPending: boolean;
  errorMessage: string | null;
  onContinue: () => void;
}) {
  const tier = TIER_MANIFEST[target];
  const point = cycle === 'annual' ? tier.prices.annual : tier.prices.monthly;
  const founding = foundingEligible && claimFounding && tier.promo ? tier.promo : null;
  const amountCents = founding ? founding.annual.usdCents : (point?.usdCents ?? 0);
  const impact = `${formatUsd(amountCents)} billed ${cycle === 'annual' ? 'annually' : 'monthly'}, starting today. Renews automatically — cancel anytime.`;

  return (
    <div
      data-testid="checkout-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '14px 16px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
      }}
    >
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        {/* D117 — the provider is the user's explicit regional choice. */}
        <legend style={{ fontSize: 12, color: color.fgMuted, padding: 0, marginBottom: 6 }}>
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

      {foundingEligible && tier.promo ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            fontSize: 12.5,
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
              Claim {tier.promo.name} — {formatUsd(tier.promo.annual.usdCents)}/yr
            </strong>{' '}
            <span style={{ color: color.fgMuted }}>
              First {tier.promo.maxRedemptions} members, price locked while you stay subscribed. If
              spots run out, checkout will say so.
            </span>
          </span>
        </label>
      ) : null}

      <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft }}>{impact}</p>
      {target === 'pro' ? (
        <p style={{ margin: 0, fontSize: 11.5, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>
      ) : null}

      {errorMessage != null && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: color.red,
            background: 'rgba(239,68,68,0.08)',
            border: `1px solid ${color.red}`,
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div>
        <Button tone="primary" onClick={onContinue} disabled={isPending}>
          {isPending ? 'Opening checkout…' : 'Continue to checkout →'}
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
        padding: '8px 10px',
        background: checked ? color.primarySoft : color.card,
        border: `1px solid ${checked ? color.primaryBorder : color.line}`,
        borderRadius: radius.md,
        cursor: 'pointer',
        fontSize: 12.5,
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

/** D120 downgrade — cancel IS the route to Free; copy states the terms. */
function DowngradePanel({
  currentTier,
  currentPeriodEnd,
  onRequestCancel,
}: {
  currentTier: TierId;
  currentPeriodEnd: string | null;
  onRequestCancel: () => void;
}) {
  const end = formatBillingDate(currentPeriodEnd);
  const tierLabel = TIER_MANIFEST[currentTier].name;
  return (
    <div
      data-testid="downgrade-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        fontSize: 13,
        color: color.fgSoft,
        lineHeight: 1.55,
      }}
    >
      <p style={{ margin: 0 }}>
        {end
          ? `Your ${tierLabel} features will remain active until ${end}. Then you'll switch to Free.`
          : `Your ${tierLabel} features will remain active until the end of the current period. Then you'll switch to Free.`}{' '}
        Downgrading to Free means canceling your subscription — the next step covers cancellation,
        including the 30-day money-back guarantee if you were charged recently.
      </p>
      <div>
        <Button tone="default" onClick={onRequestCancel}>
          Continue to cancellation →
        </Button>
      </div>
    </div>
  );
}

/** Paid→paid switching has no BE path at beta — say so, honestly. */
function PaidSwitchPanel() {
  return (
    <p
      data-testid="paid-switch-panel"
      style={{
        margin: 0,
        padding: '14px 16px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        fontSize: 13,
        color: color.fgSoft,
        lineHeight: 1.55,
      }}
    >
      Switching between paid plans isn&rsquo;t self-serve yet. Cancel your current plan (it stays
      active until period end) and subscribe to the new one after — or reply to your receipt email
      and we&rsquo;ll switch you over.
    </p>
  );
}
