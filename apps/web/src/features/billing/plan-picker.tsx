'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { Button, Eyebrow, tokens } from '@declutrmail/shared';
import { ERROR_CODES, isErrorCode } from '@declutrmail/shared/contracts';
import type {
  BillingCycle,
  BillingProviderId,
  BillingSubscription,
} from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { formatUsd, priceLineFor, TIER_JOBS } from '@/features/marketing/pricing/pricing-model';
import { track } from '@/lib/posthog';

import { apiErrorCode, apiErrorDetail } from './api/use-billing-subscription';
import type { BillingIntent } from './billing-intent';
import { useChangePlan } from './api/use-change-plan';
import { useCheckout } from './api/use-checkout';
import {
  formatBillingDate,
  isDeferredDowngrade,
  MONEY_BACK_NOTE,
  planPriceLabel,
  sharedAnnualMonthsFree,
  STRIP_TIER_IDS,
  type StripTierId,
} from './billing-model';
import { launchCheckout } from './checkout';

const { color, font, radius } = tokens;

/** Self-serve checkout targets (D19) — mirrors `PurchasableTierSchema`. */
type PaidTier = 'plus' | 'pro';

/**
 * Inline plan picker (D117/D119/D120) — supersedes the PlanChangeModal
 * round-trip. One prominent monthly/annual segmented control drives
 * every price on the three cards; each non-current plan carries ONE
 * primary CTA that expands the confirm panel in place:
 *
 *   - Paid target, no granting subscription → the real checkout confirm
 *     (D226's mandatory preview: provider pick per D117, Founding Pro
 *     claim when Pro-annual per D126, the exact charge line) →
 *     `launchCheckout` opens the provider surface. Two clicks total.
 *   - Paid target with a granting subscription → the SELF-SERVE plan
 *     change (D117/D120): D226 preview of the switch, then
 *     `POST /api/billing/change-plan` on the existing subscription —
 *     provider-prorated, tier flips via webhook only.
 *   - Free target while subscribed → D120 downgrade copy routing to the
 *     cancel flow — cancel IS the downgrade-to-free mechanism.
 *
 * Errors render inline from the shared ERROR_CODES vocabulary —
 * BILLING_DISABLED / BILLING_NOT_PROVISIONED (billing dark, F-queue),
 * FOUNDING_PRO_SOLD_OUT, SUBSCRIPTION_EXISTS, FOUNDING_PLAN_LOCKED —
 * never a generic toast.
 *
 * `disabled` (billing dark 503, pending plan action, paused sub) keeps
 * the cards visible — the plans are final (D119) — but withholds every
 * checkout affordance.
 */
export function PlanPicker({
  currentTier,
  subscription,
  disabled,
  initialIntent = null,
  onRequestCancel,
  onPaymentCompleted,
  onPlanChangeAccepted,
  onPlanChangeUnconfirmed,
  onPlanChangeAttempt,
  onPlanChangeFailedKnown,
}: {
  currentTier: TierId;
  /** The latest provider subscription record (screen's read), or null. */
  subscription: BillingSubscription['subscription'];
  /** Billing dark / pending action / paused — withhold affordances. */
  disabled: boolean;
  /** Validated pricing-page/gate-nudge choice carried through auth. */
  initialIntent?: BillingIntent | null;
  /** Route to the cancel confirm (the downgrade-to-free path, D120). */
  onRequestCancel: () => void;
  /** Paddle overlay reported `checkout.completed` — payment made, tier
   *  grant pending the webhook. The screen owns the truthful pending
   *  state; this component only reports the provider fact. */
  onPaymentCompleted: (target: PaidTier, cycle: BillingCycle) => void;
  /** The change-plan endpoint accepted the switch — the screen enters
   *  the pending state until the webhook lands. */
  onPlanChangeAccepted: (next: BillingSubscription, target: PaidTier, cycle: BillingCycle) => void;
  /** A provider error on an IMMEDIATE upgrade — ambiguous outcome (the
   *  prorated charge may have applied before the response was lost).
   *  The screen must lock + poll; the panel must NOT stay open with a
   *  retryable confirm. */
  onPlanChangeUnconfirmed: (target: PaidTier, cycle: BillingCycle) => void;
  /** Fired BEFORE the change-plan request — the screen writes the
   *  persistent lock pessimistically so an unmount/reload mid-flight
   *  cannot leave an armed retry with an unknown outcome. */
  onPlanChangeAttempt: (target: PaidTier, cycle: BillingCycle) => void;
  /** The failure is KNOWN (definitive rejection / non-provider error —
   *  nothing applied, nothing charged): release the attempt lock. */
  onPlanChangeFailedKnown: () => void;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(initialIntent?.cycle ?? 'annual');
  const [selected, setSelected] = useState<StripTierId | null>(null);
  const [provider, setProvider] = useState<BillingProviderId>('paddle');
  const [claimFounding, setClaimFounding] = useState(
    initialIntent ? initialIntent.promo === 'foundingPro' : true,
  );
  const checkout = useCheckout();
  const changePlan = useChangePlan();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const consumedIntent = useRef(false);

  // A subscription that GRANTS (active/past_due) routes paid targets
  // through the change-plan endpoint; anything else (none, canceled,
  // paused — which `disabled` already locks) is a fresh checkout.
  const grantingSub =
    subscription !== null &&
    (subscription.status === 'active' || subscription.status === 'past_due')
      ? subscription
      : null;

  // A pricing-page/gate-nudge CTA lands with an exact plan+cycle — open
  // the confirm panel directly (the deep link IS the plan click).
  const intentPlan = initialIntent?.plan ?? null;
  useEffect(() => {
    if (intentPlan && !disabled && !consumedIntent.current) {
      consumedIntent.current = true;
      setSelected(intentPlan);
    }
  }, [intentPlan, disabled]);

  const foundingEligible = selected === 'pro' && cycle === 'annual' && grantingSub === null;
  const founding = foundingEligible && claimFounding;
  const errorMessage = checkoutErrorMessage(checkout.error);
  const monthsFree = sharedAnnualMonthsFree();

  function closePanel() {
    setSelected(null);
    checkout.reset();
    changePlan.reset();
    setLaunchError(null);
  }

  function onSelect(id: StripTierId) {
    if (disabled) return;
    // The current plan card carries no CTA — but with a PADDLE granting
    // sub, the CURRENT TIER at the OTHER cycle is a valid switch target
    // (Razorpay changes aren't self-serve — no cycle switch either).
    if (id === currentTier && grantingSub?.provider !== 'paddle') return;
    checkout.reset();
    changePlan.reset();
    setLaunchError(null);
    setSelected((prev) => (prev === id ? null : id));
  }

  function onConfirm(target: PaidTier) {
    if (checkout.isPending) return;
    setLaunchError(null);
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
          void launchCheckout(session, {
            // Payment made in the overlay — collapse the confirm panel
            // and hand the screen the truthful pending state.
            onCompleted: () => {
              closePanel();
              onPaymentCompleted(target, cycle);
            },
          }).then(
            () => undefined,
            // Provider script failed to load — keep the panel open with
            // an honest retryable message.
            () => {
              checkout.reset();
              setLaunchError(
                'The secure checkout window could not be opened. Nothing was charged — please try again.',
              );
            },
          );
        },
      },
    );
  }

  function onConfirmChange(target: PaidTier) {
    if (changePlan.isPending) return;
    void track('plan_change_started', { tier: target, cycle, from_tier: currentTier });
    const from = grantingSub;
    // Pessimistic lock BEFORE the money-moving request: if this tab
    // unmounts or reloads mid-flight, these mutate callbacks never run
    // and the persisted lock is what prevents an armed blind retry.
    onPlanChangeAttempt(target, cycle);
    changePlan.mutate(
      { tierId: target, cycle },
      {
        onSuccess: (next) => {
          closePanel();
          onPlanChangeAccepted(next, target, cycle);
        },
        onError: (error) => {
          // AMBIGUOUS provider error on an immediate upgrade — the
          // prorated charge may have applied before the response was
          // lost. Hand off to the screen's lock+poll instead of leaving
          // this panel armed for a retry. A DEFINITIVE rejection
          // (details.providerOutcome, set only when the provider itself
          // refused the call — nothing applied, nothing charged) stays
          // inline and retryable, as do deferred ($0) downgrades and
          // every non-provider error — those release the attempt lock.
          if (
            apiErrorCode(error) === 'BILLING_PROVIDER_ERROR' &&
            apiErrorDetail(error, 'providerOutcome') !== 'definitive' &&
            from !== null &&
            !isDeferredDowngrade(from.tier, from.cycle, target, cycle)
          ) {
            closePanel();
            onPlanChangeUnconfirmed(target, cycle);
          } else {
            onPlanChangeFailedKnown();
          }
        },
      },
    );
  }

  return (
    <section
      aria-label="Plans"
      data-testid="plan-picker"
      style={{
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        boxShadow: tokens.shadow.card,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Eyebrow>Plans</Eyebrow>
        <CycleToggle cycle={cycle} onChange={setCycle} monthsFree={monthsFree} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {STRIP_TIER_IDS.map((id) => (
          <PlanCard
            key={id}
            tierId={id}
            cycle={cycle}
            isCurrent={id === currentTier}
            currentCycle={grantingSub?.provider === 'paddle' ? grantingSub.cycle : null}
            isSelected={id === selected}
            disabled={disabled}
            hasGrantingSubscription={grantingSub !== null}
            onSelect={() => onSelect(id)}
          />
        ))}
      </div>

      {selected !== null && !disabled ? (
        selected === 'free' ? (
          grantingSub !== null ? (
            <DowngradePanel
              currentTier={currentTier}
              currentPeriodEnd={grantingSub.currentPeriodEnd}
              onRequestCancel={() => {
                closePanel();
                onRequestCancel();
              }}
            />
          ) : null
        ) : grantingSub !== null ? (
          grantingSub.provider === 'paddle' ? (
            <ChangePlanPanel
              target={selected}
              cycle={cycle}
              fromTier={grantingSub.tier}
              fromCycle={grantingSub.cycle}
              currentPeriodEnd={grantingSub.currentPeriodEnd}
              isPending={changePlan.isPending}
              errorMessage={
                changePlan.error ? planChangeInlineErrorMessage(changePlan.error) : null
              }
              onConfirm={() => onConfirmChange(selected)}
              onDismiss={closePanel}
            />
          ) : (
            <RazorpaySwitchPanel target={selected} cycle={cycle} onDismiss={closePanel} />
          )
        ) : (
          <ConfirmPanel
            target={selected}
            cycle={cycle}
            provider={provider}
            onProviderChange={setProvider}
            foundingEligible={foundingEligible}
            claimFounding={claimFounding}
            onClaimFoundingChange={setClaimFounding}
            isPending={checkout.isPending}
            errorMessage={launchError ?? errorMessage}
            onConfirm={() => onConfirm(selected)}
            onDismiss={closePanel}
          />
        )
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Link
          href="/pricing"
          style={{ fontSize: 12.5, color: color.primary, textDecoration: 'none' }}
        >
          See the full comparison →
        </Link>
        <span style={{ fontSize: 11.5, color: color.fgMuted }}>
          All paid plans: {MONEY_BACK_NOTE}
        </span>
      </div>
    </section>
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

/**
 * Inline message for a change-plan failure that STAYS in the panel.
 * Only two provider-error shapes ever render here — a DEFINITIVE
 * rejection (any direction: provider refused, nothing applied or
 * charged) or an AMBIGUOUS failure on a $0 deferred downgrade —
 * because ambiguous upgrades leave the panel for the lock+poll. The
 * shared "could not be reached" copy is wrong for both: a definitive
 * 4xx WAS reached, and an ambiguous one may have been.
 */
export function planChangeInlineErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (apiErrorCode(error) === 'BILLING_PROVIDER_ERROR') {
    return apiErrorDetail(error, 'providerOutcome') === 'definitive'
      ? 'The payment provider declined this change — nothing was applied or charged. Try again, or email support@declutrmail.com.'
      : 'The payment provider didn’t confirm the change. Scheduling a downgrade never charges anything — please try again.';
  }
  return checkoutErrorMessage(error);
}

function CycleToggle({
  cycle,
  onChange,
  monthsFree,
}: {
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  /** Manifest-derived annual saving shared by every paid plan, or null. */
  monthsFree: number | null;
}) {
  const options: { value: BillingCycle; label: string }[] = [
    { value: 'monthly', label: 'Monthly' },
    {
      value: 'annual',
      label: monthsFree !== null ? `Annual — ${monthsFree} months free` : 'Annual',
    },
  ];
  return (
    <div
      role="group"
      aria-label="Billing interval"
      data-testid="cycle-toggle"
      style={{
        display: 'inline-flex',
        background: color.paper,
        border: `1px solid ${color.border}`,
        borderRadius: radius.pill,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const on = cycle === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            style={{
              border: 'none',
              cursor: 'pointer',
              height: 30,
              padding: '0 14px',
              borderRadius: radius.pill,
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              background: on ? color.fg : 'transparent',
              color: on ? color.bg : color.fgSoft,
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

function PlanCard({
  tierId,
  cycle,
  isCurrent,
  currentCycle,
  isSelected,
  disabled,
  hasGrantingSubscription,
  onSelect,
}: {
  tierId: StripTierId;
  cycle: BillingCycle;
  isCurrent: boolean;
  /** The granting subscription's billing cycle, or null without one. */
  currentCycle: BillingCycle | null;
  isSelected: boolean;
  disabled: boolean;
  hasGrantingSubscription: boolean;
  onSelect: () => void;
}) {
  const tier = TIER_MANIFEST[tierId];
  const price = priceLineFor(tier, cycle);
  // CTA per card state. Every non-current card gets one so the row
  // reads as equals; the current card's only action is switching its
  // billing cycle via the toggle.
  const cta = isCurrent
    ? hasGrantingSubscription && currentCycle !== null && currentCycle !== cycle
      ? `Switch to ${cycle} billing`
      : null
    : tierId === 'free'
      ? hasGrantingSubscription
        ? 'Switch to Free'
        : null
      : hasGrantingSubscription
        ? `Switch to ${tier.name}`
        : `Upgrade to ${tier.name}`;

  return (
    <div
      data-testid={`plan-option-${tierId}`}
      aria-current={isCurrent ? 'true' : undefined}
      style={{
        flex: '1 1 160px',
        padding: '14px 16px',
        background: isSelected ? color.primarySoft : color.paper,
        border: `1px solid ${isSelected ? color.primaryBorder : color.line}`,
        borderRadius: radius.md,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 14, fontWeight: 650, color: color.fg }}>
          {tierId === 'pro' ? '⭐ ' : ''}
          {tier.name}
        </span>
        {isCurrent ? (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: color.primary,
            }}
          >
            Current
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: 15, color: color.fg, fontVariantNumeric: 'tabular-nums' }}>
        {price ? `${price.amount}${price.per}` : '—'}
        {price?.note ? (
          <span style={{ color: color.fgMuted, fontSize: 11.5 }}> · {price.note}</span>
        ) : null}
      </span>
      <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.4 }}>
        {TIER_JOBS[tierId]}
      </span>
      {cta && !disabled ? (
        // marginTop auto pins every CTA to the card's bottom edge so
        // the row of buttons sits on ONE line regardless of how much
        // text each card carries.
        <div style={{ marginTop: 'auto', paddingTop: 10 }}>
          <Button
            tone={tierId === 'free' ? 'default' : 'primary'}
            onClick={onSelect}
            ariaLabel={cta}
          >
            {cta}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Razorpay plan changes are not self-serve at launch — the BE fails
 * closed with PLAN_CHANGE_UNSUPPORTED (untested provider update
 * semantics + no Razorpay catalog provisioned; see razorpay.adapter).
 * Say so honestly and hand the user the prefilled support route
 * instead of a confirm button that can only error.
 */
function RazorpaySwitchPanel({
  target,
  cycle,
  onDismiss,
}: {
  target: PaidTier;
  cycle: BillingCycle;
  onDismiss: () => void;
}) {
  const mailto = `mailto:support@declutrmail.com?subject=${encodeURIComponent(
    'Plan change request',
  )}&body=${encodeURIComponent(
    `Please switch my subscription to ${TIER_MANIFEST[target].name} (${cycle}).`,
  )}`;
  return (
    <div
      data-testid="razorpay-switch-panel"
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
        Plan changes aren&rsquo;t self-serve yet for subscriptions paid via Razorpay — email us and
        we&rsquo;ll switch you to {TIER_MANIFEST[target].name} ({cycle}), usually within a day. Your
        current plan keeps working in the meantime.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <a
          href={mailto}
          style={{ fontSize: 12.5, color: color.primary, fontWeight: 600, textDecoration: 'none' }}
        >
          Email support with your request →
        </a>
        <Button tone="default" onClick={onDismiss}>
          Keep current plan
        </Button>
      </div>
    </div>
  );
}

/**
 * The D226 confirm step for a PLAN CHANGE on the existing subscription
 * (D117/D120): states the from→to switch, the new price, and the
 * provider-prorated billing consequence, then ONE confirm into
 * `POST /api/billing/change-plan`. No provider pick and no overlay —
 * the change rides the subscription's existing payment method.
 */
function ChangePlanPanel({
  target,
  cycle,
  fromTier,
  fromCycle,
  currentPeriodEnd,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  target: PaidTier;
  cycle: BillingCycle;
  fromTier: PaidTier;
  fromCycle: BillingCycle;
  currentPeriodEnd: string | null;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const toLabel = planPriceLabel(target, cycle);
  const samePlan = target === fromTier && cycle === fromCycle;
  const isDowngrade = isDeferredDowngrade(fromTier, fromCycle, target, cycle);
  const effectiveDate = formatBillingDate(currentPeriodEnd);
  return (
    <div
      data-testid="change-plan-panel"
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
      <Eyebrow>Preview · before anything changes</Eyebrow>
      {samePlan ? (
        <p style={{ margin: 0, fontSize: 13, color: color.fgSoft }}>
          This is your current plan and billing cycle — nothing to change.
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, color: color.fg }}>
            <strong style={{ fontWeight: 600 }}>
              {TIER_MANIFEST[fromTier].name} ({fromCycle}) → {TIER_MANIFEST[target].name} ({cycle})
            </strong>
            {toLabel ? (
              <span style={{ color: color.fgSoft }}>
                {' '}
                — {toLabel}{' '}
                {isDowngrade
                  ? effectiveDate
                    ? `from ${effectiveDate}.`
                    : 'from your next renewal.'
                  : 'from now on.'}
              </span>
            ) : null}
          </p>
          {isDowngrade ? (
            <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft }}>
              <strong style={{ fontWeight: 600, color: color.fg }}>$0 today.</strong> Your current
              plan stays active
              {effectiveDate ? ` through ${effectiveDate}` : ' through this billing period'}, then{' '}
              {TIER_MANIFEST[target].name} ({cycle}) begins. There is no refund or credit for the
              period you already paid for.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft }}>
              The upgrade applies after your payment provider confirms it, using your existing
              payment method. The prorated difference for the rest of this period is charged now.
            </p>
          )}
          <p style={{ margin: 0, fontSize: 11.5, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>
        </>
      )}

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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="primary" onClick={onConfirm} disabled={isPending || samePlan}>
          {isPending
            ? isDowngrade
              ? 'Scheduling…'
              : 'Applying…'
            : isDowngrade
              ? 'Schedule downgrade'
              : 'Confirm upgrade'}
        </Button>
        <Button tone="default" onClick={onDismiss} disabled={isPending}>
          Keep current plan
        </Button>
      </div>
    </div>
  );
}

/**
 * The D226 mandatory confirm step — a lightweight preview of exactly
 * what will be charged, then ONE confirm into the provider surface.
 */
function ConfirmPanel({
  target,
  cycle,
  provider,
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
  provider: BillingProviderId;
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
  const amountCents = founding ? founding.annual.usdCents : (point?.usdCents ?? null);
  const impact =
    amountCents !== null
      ? `${formatUsd(amountCents)} billed ${cycle === 'annual' ? 'annually' : 'monthly'}, starting today. Renews automatically — cancel anytime.`
      : `Pricing for the ${cycle} cycle isn't available right now — try the other billing cycle.`;

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
      <Eyebrow>Preview · before anything changes</Eyebrow>
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
      <p style={{ margin: 0, fontSize: 11.5, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>

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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="primary" onClick={onConfirm} disabled={isPending || amountCents === null}>
          {isPending ? 'Opening checkout…' : 'Confirm — continue to secure checkout →'}
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
