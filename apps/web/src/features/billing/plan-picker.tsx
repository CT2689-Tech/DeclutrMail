'use client';

import linkStyles from './billing-links.module.css';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';

import { Button, Pill, tokens, useIsAtMost } from '@declutrmail/shared';
import { ERROR_CODES, isErrorCode } from '@declutrmail/shared/contracts';
import type {
  BillingCycle,
  BillingProviderId,
  BillingSubscription,
} from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import {
  currencyForPricePoint,
  formatMoney,
  priceLineFor,
  TIER_JOBS,
} from '@/features/marketing/pricing/pricing-model';
import { track } from '@/lib/posthog';

import { apiErrorCode, apiErrorDetail } from './api/use-billing-subscription';
import { billingKeys } from './api/query-keys';
import type { BillingIntent } from './billing-intent';
import { useChangePlan } from './api/use-change-plan';
import { useCheckout } from './api/use-checkout';
import { useFoundingRemaining } from './api/use-founding-remaining';
import {
  formatBillingDate,
  isDeferredDowngrade,
  sharedAnnualMonthsFree,
  STRIP_TIER_IDS,
  type StripTierId,
  type SubscriptionRecord,
} from './billing-model';
import { launchCheckout } from './checkout';
import { PlanConsequences } from './plan-coverage';
import { GroupTitle } from '@/features/settings/settings-list';

const ChangePlanPanel = dynamic(
  () => import('./change-plan-panel').then((module) => module.ChangePlanPanel),
  {
    ssr: false,
    loading: () => <p role="status">Loading plan preview…</p>,
  },
);

const ConfirmPanel = dynamic(
  () => import('./checkout-confirm-panel').then((module) => module.ConfirmPanel),
  { ssr: false, loading: () => <p role="status">Loading checkout preview…</p> },
);

const BillingComparison = dynamic(
  () => import('./billing-comparison').then((module) => module.BillingComparison),
  {
    ssr: false,
    loading: () => <p role="status">Loading plan comparison…</p>,
  },
);

const { color, font, motion, radius, shadow, text } = tokens;

/** Self-serve checkout targets (D19) — mirrors `PurchasableTierSchema`. */
type PaidTier = 'plus' | 'pro';

/**
 * The Razorpay catalog id backing EXACTLY the price point a confirm
 * would buy — null when that point is unprovisioned (D117: India is
 * deferred, so every point is null at launch). Promo and standard
 * annual are separate price points with separate ids, so `founding`
 * has to be part of the question.
 */
function razorpayIdFor(target: PaidTier, cycle: BillingCycle, founding: boolean): string | null {
  const tier = TIER_MANIFEST[target];
  if (founding && tier.promo) return tier.promo.annual.razorpayPlanId;
  const point = cycle === 'annual' ? tier.prices.annual : tier.prices.monthly;
  return point?.razorpayPlanId ?? null;
}

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
/**
 * Error codes BillingService.createCheckout throws BEFORE the atomic
 * pending-checkout claim (and therefore before any provider session can
 * exist). Mirrors the service's throw ordering — extend BOTH together.
 * Anything not in this set is treated as post-claim/ambiguous and
 * surfaces the reservation instead of releasing it.
 */
/**
 * Codes that PROVE this screen's billing read is stale.
 *
 * Each one is the server saying "the subscription state you just acted on is
 * not the state I hold". Left alone, the user is stranded: the cards still
 * invite an upgrade because the cached read shows no subscription, the inline
 * error says one already exists, and nothing on screen can reconcile them —
 * so there is no control to reach for. Copy cannot fix that; only refetching
 * can (Codex stop-review 2026-07-29).
 *
 * Reaching one of these therefore invalidates the subscription query, so the
 * real state — and with it the real controls (Cancel subscription, resume
 * where the rail supports it, the pending-change notice) — renders under the
 * message. This is the same rule the app already follows for a guard's 4xx:
 * it is a designed state to reconcile with, not a retry (CLAUDE.md §8).
 *
 * `SUBSCRIPTION_REFUND_SETTLING` is deliberately ABSENT (D253), and the
 * absence is the point. To reach checkout at all the read must have shown no
 * granting and no blocking row — which during the settling window is TRUE:
 * the refund already ended the entitlement, the customer holds nothing. The
 * read is stale only about a dead row. Refetching would replace an accurate
 * "you're on Free, pick a plan" screen with the non-backing notice for a
 * subscription the customer no longer has ("A Plus subscription is on your
 * account… Cancel it if you're done with it") and would DISABLE the picker —
 * unmounting the confirm panel, and with it the honest message this code was
 * created to deliver. It would reinstate, one surface over, both lies this
 * code exists to remove.
 *
 * The stranding this set prevents also does not apply: nothing on screen
 * contradicts the message, and the state needs no hidden control to resolve —
 * it is `retryable: true`, it clears on its own, and the control the user
 * retries from is the one already in front of them.
 */
const STALE_BILLING_READ = new Set([
  'SUBSCRIPTION_EXISTS',
  'SUBSCRIPTION_PAUSED_BLOCKS_NEW',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_CANCELING',
  'FOUNDING_PLAN_LOCKED',
  'PLAN_CHANGE_PENDING',
]);

const PRE_CLAIM_REJECTIONS = new Set([
  'SUBSCRIPTION_EXISTS',
  // Thrown by the SAME guard as SUBSCRIPTION_EXISTS, one branch apart, so it
  // is equally pre-claim. Omitting it would treat a paused-subscription
  // refusal as an ambiguous post-claim outcome and surface a payment
  // reservation for a checkout that never reached a provider.
  'SUBSCRIPTION_PAUSED_BLOCKS_NEW',
  // The third branch of that same guard (D253) — also thrown before the
  // claim, before any provider call. Omitting it would tell a customer whose
  // refund is still settling that a payment may be pending, which is the
  // opposite of true: they were just refused, nothing reached a provider,
  // and the reservation would lock the retry the message invites.
  'SUBSCRIPTION_REFUND_SETTLING',
  'FOUNDING_PRO_SOLD_OUT',
  'BILLING_NOT_PROVISIONED',
  'BILLING_DISABLED',
  'BAD_REQUEST',
  'UNAUTHORIZED',
]);

export function PlanPicker({
  currentTier,
  grantingSub,
  disabled,
  initialIntent = null,
  initialProvider = 'paddle',
  onRequestCancel,
  onPaymentCompleted,
  onCheckoutAttempt,
  onCheckoutAbandoned,
  onCheckoutClosed,
  onPlanChangeAccepted,
  onPlanChangeUnconfirmed,
  onPlanChangeAttempt,
  onPlanChangeFailedKnown,
}: {
  currentTier: TierId;
  /** The BACKING subscription in a granting status (active/past_due AND
   *  tier === entitlement), or null — resolved by the screen's derive
   *  layer (A6). Drives change-vs-checkout routing (D117/D120): a
   *  non-backing row must never route paid targets through change-plan,
   *  and a workspace whose entitlement is granted from elsewhere keeps
   *  its checkout affordances. */
  grantingSub: SubscriptionRecord | null;
  /** Billing dark / pending action / paused — withhold affordances. */
  disabled: boolean;
  /** Validated pricing-page/gate-nudge choice carried through auth. */
  initialIntent?: BillingIntent | null;
  /** Geo-derived default rail (D117). Only a DEFAULT — the radio
   *  overrides it, and `effectiveProvider` still clamps it against the
   *  catalog so an unprovisioned region can never be preselected. */
  initialProvider?: BillingProviderId;
  /** Route to the cancel confirm (the downgrade-to-free path, D120). */
  onRequestCancel: () => void;
  /** Paddle overlay reported `checkout.completed` — payment made, tier
   *  grant pending the webhook. The screen owns the truthful pending
   *  state; this component only reports the provider fact. `attemptId`
   *  is this checkout's reservation id (own-id transition). */
  onPaymentCompleted: (target: PaidTier, cycle: BillingCycle, attemptId: string) => void;
  /** Atomic claim + `checkout_intent` RESERVATION before any checkout
   *  session is created or overlay opened — without it a second tab
   *  could open a second payment surface while the first is unpaid.
   *  Null means the slot (or mutex) is held: stand down. */
  onCheckoutAttempt: (target: PaidTier, cycle: BillingCycle) => Promise<string | null>;
  /** No payment surface ever existed for this reservation (session
   *  POST failed / provider script never loaded) — hard-release it
   *  (id-matched). NEVER used for `checkout.closed`: a closed overlay
   *  is not proof no payment occurred. */
  /** The overlay CLOSED without a completed event — strong evidence of
   *  no payment but not proof (popup/3DS edges). The screen surfaces
   *  the reservation (outcome-neutral, polling, immediate two-step
   *  release) instead of unlocking checkout. */
  /** Pre-claim rejection — the server refused BEFORE any claim/session
   *  existed (SUBSCRIPTION_EXISTS, catalog gaps, billing dark). Nothing
   *  is at risk; the reservation releases and the inline alert owns the
   *  message. */
  onCheckoutAbandoned: (attemptId: string) => void;
  onCheckoutClosed: (attemptId: string) => void;
  /** The change-plan endpoint accepted the switch — the screen enters
   *  the pending state until the webhook lands. `attemptId` identifies
   *  the pessimistic lock this attempt wrote (UUID-matched release). */
  onPlanChangeAccepted: (
    next: BillingSubscription,
    target: PaidTier,
    cycle: BillingCycle,
    attemptId: string,
  ) => void;
  /** A provider error on an IMMEDIATE upgrade — ambiguous outcome (the
   *  prorated charge may have applied before the response was lost).
   *  The screen must lock + poll; the panel must NOT stay open with a
   *  retryable confirm. `attemptId` lets the screen tell this attempt's
   *  own lock from a concurrent one it must not clobber. */
  onPlanChangeUnconfirmed: (target: PaidTier, cycle: BillingCycle, attemptId: string) => void;
  /** Fired BEFORE the change-plan request — the screen writes the
   *  persistent lock pessimistically so an unmount/reload mid-flight
   *  cannot leave an armed retry with an unknown outcome. Returns the
   *  attempt's UUID; every release call must present it back. */
  onPlanChangeAttempt: (target: PaidTier, cycle: BillingCycle) => Promise<string | null>;
  /** The failure is KNOWN (definitive rejection / non-provider error —
   *  nothing applied, nothing charged): release the attempt lock. The
   *  UUID uniquely identifies WHICH attempt — the screen releases only
   *  the lock that exact attempt wrote, never a concurrent attempt's
   *  unresolved lock (target matching is not unique). */
  onPlanChangeFailedKnown: (attemptId: string) => void;
}) {
  const isPhone = useIsAtMost('xs');
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [cycle, setCycle] = useState<BillingCycle>(initialIntent?.cycle ?? 'annual');
  const [selected, setSelected] = useState<StripTierId | null>(null);
  const [provider, setProvider] = useState<BillingProviderId>(initialProvider);
  // Default OFF. The control reads "Claim Founding Pro", which is the
  // language of an opt-in, and it was pre-ticked — so the quoted price and
  // the confirm button committed to a promotional price point the user never
  // chose. Founding Pro is also change-LOCKED once bought
  // (`FOUNDING_PLAN_LOCKED`), so a default-on discount silently opts someone
  // into a subscription they cannot re-plan. An explicit deep link
  // (`initialIntent.promo`) still arrives pre-ticked, because there the user
  // did choose it. Founder call, 2026-07-29.
  const [claimFounding, setClaimFounding] = useState(initialIntent?.promo === 'foundingPro');
  const queryClient = useQueryClient();
  const checkout = useCheckout();

  /**
   * The server just contradicted our billing read — refetch so the screen
   * stops arguing with it. Called from BOTH mutation error paths; without it
   * the plan cards keep inviting an action the server has already refused,
   * with no control on screen able to resolve the disagreement.
   */
  function reconcileIfStale(code: string | null): void {
    if (code !== null && STALE_BILLING_READ.has(code)) {
      void queryClient.invalidateQueries({ queryKey: billingKeys.subscription() });
    }
  }
  const changePlan = useChangePlan();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const consumedIntent = useRef(false);
  // Synchronous re-entrancy guard: the async slot claim yields before
  // the mutation's isPending flips, so a double-click could otherwise
  // enter a confirm handler twice in one frame.
  const confirmInFlight = useRef(false);

  // A pricing-page/gate-nudge CTA lands with an exact plan+cycle — open
  // the confirm panel directly (the deep link IS the plan click).
  const intentPlan = initialIntent?.plan ?? null;
  const intentCycle = initialIntent?.cycle ?? null;
  useEffect(() => {
    // QA-sign-in-20260829-03: a deep link naming the tier AND cycle the
    // visitor is already on (e.g. a stale bookmarked/shared pricing link)
    // must not auto-open a "confirm your plan" panel for the plan they
    // already have — nothing would change, so there is nothing to confirm.
    // A deep link naming a DIFFERENT tier, OR the same tier at a DIFFERENT
    // cycle (a real monthly<->annual switch), still opens normally; both
    // are the intended change flow.
    const intentCycleDiffers =
      intentCycle !== null && grantingSub !== null && intentCycle !== grantingSub.cycle;
    if (
      intentPlan &&
      (intentPlan !== currentTier || intentCycleDiffers) &&
      !disabled &&
      !consumedIntent.current
    ) {
      consumedIntent.current = true;
      setSelected(intentPlan);
    }
  }, [intentPlan, intentCycle, currentTier, disabled, grantingSub]);

  // A lock landing mid-session (pending action started in THIS tab or
  // ANOTHER via the storage event) must disarm any already-open confirm
  // panel — an open panel's Confirm is a charge-capable control and may
  // not outlive the lock that says a money outcome is unresolved.
  useEffect(() => {
    if (disabled && selected !== null) {
      setSelected(null);
      checkout.reset();
      changePlan.reset();
      setLaunchError(null);
    }
    // Reset fns are referentially stable — deps stay minimal on purpose.
  }, [disabled, selected]);

  // QA-billing-20260901-09/-05: independent of `selected` — the Pro
  // card's own disclosure needs this before the confirm panel is ever
  // opened, not just once it is.
  const foundingPossible = cycle === 'annual' && grantingSub === null;
  const foundingAvailability = useFoundingRemaining(foundingPossible);
  // Advisory only (the checkout guard's own read stays authoritative) —
  // while the count hasn't loaded yet, do not claim sold-out.
  const foundingSoldOut =
    foundingPossible &&
    foundingAvailability.data !== undefined &&
    foundingAvailability.data.remaining <= 0;
  const foundingEligible =
    selected === 'pro' && cycle === 'annual' && grantingSub === null && !foundingSoldOut;
  const founding = foundingEligible && claimFounding;
  // Offering a provider and BILLING with it must read the same fact, or
  // a `provider` pick outlives the price point that offered it: the
  // Founding Pro checkbox swaps the purchased price point WITHOUT
  // remounting the panel, so a Razorpay pick made on standard Pro annual
  // would ride a promo checkout that has no Razorpay id — straight into
  // BILLING_NOT_PROVISIONED. Derived once here; the panel renders from
  // it and `onConfirm` clamps to it.
  const razorpayOffered =
    selected !== null && selected !== 'free' && razorpayIdFor(selected, cycle, founding) !== null;
  const effectiveProvider: BillingProviderId = razorpayOffered ? provider : 'paddle';
  // The STRIP's currency. `razorpayOffered` is per-price-point, so with
  // no plan selected yet it is false and the strip would snap to USD
  // even for an India-defaulted picker; fall back to the chosen rail
  // when there is nothing selected to clamp against.
  const stripProvider: BillingProviderId = selected === null ? provider : effectiveProvider;
  const errorMessage = checkoutErrorMessage(checkout.error);
  const monthsFree = sharedAnnualMonthsFree(stripProvider);

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

  async function onConfirm(target: PaidTier) {
    // `disabled` re-checked at fire time: a lock can land between the
    // panel opening and this click (cross-tab storage event race) —
    // and React state can lag storage, so the slot is claimed
    // ATOMICALLY (Web Locks mutex) and RESERVED (`checkout_intent`)
    // before any payment surface can open. A second tab's claim now
    // finds the reservation and stands down.
    if (disabled || checkout.isPending || confirmInFlight.current) return;
    confirmInFlight.current = true;
    const attemptId = await onCheckoutAttempt(target, cycle);
    confirmInFlight.current = false;
    if (attemptId === null) {
      closePanel();
      return;
    }
    setLaunchError(null);
    const funnel = {
      tier: target,
      cycle,
      provider: effectiveProvider,
      founding_pro: founding,
    } as const;
    // Intent only — the POST below is what writes `pending_checkouts`.
    void track('checkout_started', funnel);
    checkout.mutate(
      {
        tierId: target,
        cycle,
        provider: effectiveProvider,
        ...(founding ? { promo: 'foundingPro' as const } : {}),
      },
      {
        onSuccess: (session) => {
          // Server claim exists from this response; overlay is next.
          void track('checkout_session_created', funnel);
          void launchCheckout(session, {
            // Payment made in the overlay — collapse the confirm panel
            // and hand the screen the truthful pending state (own-id
            // transition over this checkout's reservation).
            onCompleted: () => {
              void track('checkout_overlay_completed', funnel);
              closePanel();
              onPaymentCompleted(target, cycle, attemptId);
            },
            // Overlay dismissed without a completed event — NOT proof
            // of no payment (popup/3DS edges). Surface the reservation
            // instead of releasing it; the user re-arms via the
            // explicit no-charge assertion. (Post-completion close is
            // inert: the id no longer matches the `checkout` lock.)
            onClosed: () => {
              void track('checkout_overlay_closed', funnel);
              closePanel();
              onCheckoutClosed(attemptId);
            },
          }).then(
            () => undefined,
            // Provider script failed to load — no overlay opened, but
            // the SESSION exists server-side and the claim is held: a
            // Razorpay subscription created with customer_notify is
            // payable from the provider's own emailed link, so this is
            // NOT "nothing at risk" (Codex 2026-07-29). Surface the
            // reservation — the banner explains the locked state and
            // owns the release path.
            () => {
              void track('checkout_overlay_blocked', funnel);
              checkout.reset();
              setLaunchError(
                'The secure checkout window could not be opened. Nothing was charged.',
              );
              onCheckoutClosed(attemptId);
            },
          );
        },
        // Two different failures wear this callback (Codex
        // 2026-07-29). A PRE-CLAIM rejection — the server refused
        // before any claim or provider session existed — releases the
        // reservation and lets the inline alert own the message
        // (SUBSCRIPTION_EXISTS and friends throw ahead of the claim in
        // BillingService.createCheckout; the code list below mirrors
        // that ordering). Everything else is POST-CLAIM: the server
        // holds the claim (#433 — a thrown error is not proof the
        // provider saw nothing, and an orphaned Razorpay subscription
        // is payable from its emailed link), so releasing locally left
        // live CTAs beside a server that refused the retry with
        // CHECKOUT_IN_FLIGHT naming a control the user could not see.
        // Those surface the reservation: the banner states the locked
        // reality and owns the release.
        onError: (err) => {
          const code = apiErrorCode(err);
          void track('checkout_failed', { ...funnel, code: code ?? 'unknown' });
          reconcileIfStale(code);
          if (code !== null && PRE_CLAIM_REJECTIONS.has(code)) {
            onCheckoutAbandoned(attemptId);
          } else {
            onCheckoutClosed(attemptId);
          }
        },
      },
    );
  }

  async function onConfirmChange(target: PaidTier) {
    // `disabled` re-checked at fire time: a lock can land between the
    // panel opening and this click (cross-tab storage event race).
    if (disabled || changePlan.isPending || confirmInFlight.current) return;
    confirmInFlight.current = true;
    const from = grantingSub;
    // Pessimistic lock BEFORE the money-moving request: if this tab
    // unmounts or reloads mid-flight, these mutate callbacks never run
    // and the persisted lock is what prevents an armed blind retry.
    // The claim + write happen in ONE mutex hold — a null claim means
    // the slot is held (an unresolved record, or another tab mid-
    // action) — stand down.
    const attemptId = await onPlanChangeAttempt(target, cycle);
    confirmInFlight.current = false;
    if (attemptId === null) {
      closePanel();
      return;
    }
    void track('plan_change_started', { tier: target, cycle, from_tier: currentTier });
    changePlan.mutate(
      { tierId: target, cycle },
      {
        onSuccess: (next) => {
          closePanel();
          onPlanChangeAccepted(next, target, cycle, attemptId);
        },
        onError: (error) => {
          reconcileIfStale(apiErrorCode(error));
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
            onPlanChangeUnconfirmed(target, cycle, attemptId);
          } else {
            onPlanChangeFailedKnown(attemptId);
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
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
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
        <GroupTitle as="div">Plans</GroupTitle>
        <CycleToggle cycle={cycle} onChange={setCycle} monthsFree={monthsFree} />
      </div>

      {initialIntent?.promo === 'foundingPro' && grantingSub !== null ? (
        <p
          role="status"
          style={{
            margin: 0,
            padding: '12px 14px',
            border: `1px solid ${color.border}`,
            borderRadius: radius.md,
            background: color.card,
            color: color.fgSoft,
            fontSize: text.sm,
          }}
        >
          Founding Pro is for new annual Pro subscriptions. Your active paid subscription cannot be
          converted to the promotional price; your current plan remains unchanged.
        </p>
      ) : null}

      <div
        style={{
          display: 'flex',
          flexDirection: isPhone ? 'column' : 'row',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'stretch',
        }}
      >
        {STRIP_TIER_IDS.map((id) => (
          <PlanCard
            key={id}
            tierId={id}
            cycle={cycle}
            isCurrent={id === currentTier}
            currentCycle={grantingSub?.cycle ?? null}
            canSwitchCycle={grantingSub?.provider === 'paddle'}
            isSelected={id === selected}
            disabled={disabled}
            hasGrantingSubscription={grantingSub !== null}
            provider={stripProvider}
            onSelect={() => onSelect(id)}
            // QA-billing-20260901-05: disclose the Founding Pro price on
            // the card itself, not only one click later on the confirm
            // panel — gated on the same live availability the checkbox
            // uses, so the card never quotes a price the checkout can't
            // honor.
            showFoundingHint={
              id === 'pro' && id !== currentTier && foundingPossible && !foundingSoldOut
            }
            // QA-billing-20260901-09: a founding member's price lock is
            // otherwise discovered only after a click (a 409 on
            // change-plan). Name it on their own current-plan card.
            foundingMemberNote={
              id === currentTier && grantingSub?.foundingMember === true
                ? 'Founding Pro — price locked while this subscription stays active. Canceling ends the lock for good.'
                : null
            }
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
              provider={grantingSub.provider}
              isPending={changePlan.isPending}
              errorMessage={
                changePlan.error ? planChangeInlineErrorMessage(changePlan.error) : null
              }
              onConfirm={() => void onConfirmChange(selected)}
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
            razorpayOffered={razorpayOffered}
            onProviderChange={setProvider}
            foundingEligible={foundingEligible}
            claimFounding={claimFounding}
            onClaimFoundingChange={setClaimFounding}
            isPending={checkout.isPending}
            errorMessage={launchError ?? errorMessage}
            onConfirm={() => void onConfirm(selected)}
            onDismiss={closePanel}
          />
        )
      ) : null}

      {/* The money-back note lives in the confirm panel — the point where
          money moves — and nowhere else on this screen. */}
      <details
        style={{ width: '100%' }}
        onToggle={(event) => setComparisonOpen(event.currentTarget.open)}
      >
        <summary className={linkStyles.link} style={{ cursor: 'pointer' }}>
          Compare included features
        </summary>
        <div
          role="region"
          aria-label="Plan feature comparison"
          tabIndex={0}
          style={{ overflowX: 'auto', marginTop: 12 }}
        >
          {comparisonOpen ? <BillingComparison /> : null}
        </div>
      </details>
      <Link
        href="/pricing"
        className={linkStyles.link}
        style={{ alignSelf: 'flex-start', fontSize: text.sm }}
      >
        Compare plans
      </Link>
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
        background: color.fill,
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
              fontSize: text.sm,
              fontWeight: 600,
              background: on ? color.card : 'transparent',
              color: on ? color.fg : color.fgMuted,
              boxShadow: on ? shadow.card : 'none',
              transition: `background ${motion.fast} ${motion.ease}, color ${motion.fast} ${motion.ease}`,
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
  canSwitchCycle,
  hasGrantingSubscription,
  provider,
  showFoundingHint,
  foundingMemberNote,
  onSelect,
}: {
  tierId: StripTierId;
  cycle: BillingCycle;
  isCurrent: boolean;
  /** The granting subscription's billing cycle, or null without one. */
  currentCycle: BillingCycle | null;
  isSelected: boolean;
  disabled: boolean;
  /** Whether the rail supports a self-serve cycle switch (Paddle). */
  canSwitchCycle: boolean;
  hasGrantingSubscription: boolean;
  /** Rail the strip prices against — clamped per point, so the cards
   *  agree with the confirm panel one click later. */
  provider: BillingProviderId;
  /** QA-billing-20260901-05 — show the Founding Pro price on this card,
   *  gated by live availability (the parent already checked). */
  showFoundingHint?: boolean;
  /** QA-billing-20260901-09 — this card's own subscription carries the
   *  founding price lock; name what canceling costs. */
  foundingMemberNote?: string | null;
  onSelect: () => void;
}) {
  const tier = TIER_MANIFEST[tierId];
  const price = priceLineFor(tier, cycle, provider);
  const foundingPrice =
    showFoundingHint && tier.promo
      ? formatMoney(tier.promo.annual, currencyForPricePoint(tier.promo.annual, provider))
      : null;
  // The badge marks the plan you are ON — tier AND cycle. Tier alone
  // made it follow the cycle toggle: a Pro ANNUAL subscriber flipping
  // the strip to Monthly saw "Pro · $19/mo · CURRENT", i.e. the badge
  // asserting a price they do not pay ($190/yr) on a card that is
  // actually a switch target (founder screenshot, 2026-07-31). The CTA
  // below already drew this distinction — "Switch to monthly billing" —
  // so the card contradicted itself.
  //
  // No cycle carve-out by rail. A first pass exempted non-Paddle on the
  // grounds that the cycle was "unknowable" — it is not: `cycle` is on
  // the subscription record for every provider, and the call site was
  // simply refusing to pass it because the SWITCH CTA is Paddle-only.
  // That left a Razorpay subscriber seeing the exact lie this fix
  // removed for Paddle (Codex stop-review, 2026-07-31). The two
  // questions are now separate props: `currentCycle` is a fact on any
  // rail, `canSwitchCycle` is the affordance.
  //
  // `currentCycle` is null only when nothing grants a paid plan, i.e.
  // Free — which has no cycle, so the toggle cannot make its badge wrong.
  const isCurrentPlan = isCurrent && (!hasGrantingSubscription || currentCycle === cycle);
  // CTA per card state. Every non-current card gets one so the row
  // reads as equals; the current card's only action is switching its
  // billing cycle via the toggle.
  const cta = isCurrent
    ? hasGrantingSubscription && canSwitchCycle && currentCycle !== null && currentCycle !== cycle
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
      aria-current={isCurrentPlan ? 'true' : undefined}
      style={{
        flex: '1 1 180px',
        padding: 22,
        background: color.card,
        // Keep selection visible while using the same thin editorial boundaries.
        border: `1px solid ${isSelected ? color.primary : color.border}`,
        boxShadow: isSelected ? `0 0 0 1px ${color.primary}` : 'none',
        borderRadius: radius.md,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: `box-shadow ${motion.fast} ${motion.ease}`,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: text.lg,
            fontWeight: 650,
            letterSpacing: '-0.01em',
            color: color.fg,
          }}
        >
          {tier.name}
        </span>
        {isCurrentPlan ? <Pill tone="primary">Current</Pill> : null}
      </span>
      <span
        style={{
          fontSize: text.xl,
          fontWeight: 650,
          letterSpacing: '-0.02em',
          color: color.fg,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {price ? `${price.amount}${price.per}` : '—'}
        {price?.note ? (
          <span
            style={{ color: color.fgMuted, fontSize: text.sm, fontWeight: 400, letterSpacing: 0 }}
          >
            {' '}
            · {price.note}
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: text.sm, color: color.fgMuted, lineHeight: 1.4 }}>
        {TIER_JOBS[tierId]}
      </span>
      {foundingPrice && tier.promo ? (
        <span style={{ fontSize: text.sm, color: color.primary, lineHeight: 1.4 }}>
          {tier.promo.name}: {foundingPrice}/yr for the first 250 — confirmed at checkout.
        </span>
      ) : null}
      {foundingMemberNote ? (
        <span style={{ fontSize: text.sm, color: color.fgMuted, lineHeight: 1.4 }}>
          {foundingMemberNote}
        </span>
      ) : null}
      {cta && !disabled ? (
        // marginTop auto pins every CTA to the card's bottom edge so
        // the row of buttons sits on ONE line regardless of how much
        // text each card carries.
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <Button
            tone={tierId === 'free' ? 'default' : 'primary'}
            style={{ width: '100%' }}
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
        padding: 'clamp(18px, 4vw, 24px)',
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        fontSize: text.md,
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
          style={{
            fontSize: text.sm,
            color: color.primary,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Email support
        </a>
        <Button tone="default" onClick={onDismiss}>
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
        padding: 'clamp(18px, 4vw, 24px)',
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        fontSize: text.md,
        color: color.fgSoft,
        lineHeight: 1.55,
      }}
    >
      <p style={{ margin: 0 }}>
        {end
          ? `Your ${tierLabel} features will remain active until ${end}. Then you'll switch to Free.`
          : `Your ${tierLabel} features will remain active until the end of the current period. Then you'll switch to Free.`}{' '}
        Downgrading to Free means canceling your subscription — the next step covers cancellation.
      </p>
      <PlanConsequences fromTier={currentTier} toTier="free" />
      <div>
        <Button tone="default" onClick={onRequestCancel}>
          Continue to cancellation
        </Button>
      </div>
    </div>
  );
}
