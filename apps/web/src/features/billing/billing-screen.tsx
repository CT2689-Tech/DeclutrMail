'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  Eyebrow,
  ErrorState as RecoverableErrorState,
  ScreenIntro,
  tokens,
  toast,
} from '@declutrmail/shared';
import type { BillingSubscription, CancelRequest } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { useAuth } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { useTier } from '@/features/auth/api/use-tier';
import { formatUsd } from '@/features/marketing/pricing/pricing-model';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';

import { isBillingDisabledError, useBillingSubscription } from './api/use-billing-subscription';
import type { BillingIntent } from './billing-intent';
import { useCancelSubscription } from './api/use-cancel-subscription';
import {
  canCancel,
  formatBillingDate,
  planPriceLabel,
  PROVIDER_LABELS,
  statusNote,
} from './billing-model';
import { CancelModal } from './cancel-modal';
import { PlanPicker } from './plan-picker';

const { color, font, radius, shadow } = tokens;

/**
 * Post-checkout poll cadence — how often the screen re-reads the
 * subscription while a Paddle payment awaits its webhook grant.
 */
const PAYMENT_PROCESSING_POLL_MS = 3000;

/**
 * After this long without the webhook grant, the processing notice
 * switches to the honest "taking longer than usual" copy. Polling
 * continues — a delayed webhook still self-heals the screen.
 */
const PAYMENT_PROCESSING_SLOW_AFTER_MS = 90_000;

/**
 * Billing screen (D119) — current-plan card + inline plan picker (one
 * monthly/annual toggle, one CTA per plan into the D226 confirm step),
 * with the D118/D120 cancel flow behind its preview modal.
 *
 * Tier source of truth: while billing is DARK (503 BILLING_DISABLED —
 * the F-queue hasn't flipped `BILLING_ENABLED`), the plan card renders
 * from `/api/auth/me`'s tier and the screen states honestly that
 * subscription management isn't live yet (a designed state, never an
 * error toast). Once billing is live, `GET /api/billing/subscription`
 * is authoritative (it also carries the founding flag + provider
 * record the `me` payload doesn't).
 *
 * Post-checkout truth (§10 no-fake-completion): a Paddle overlay
 * `checkout.completed` only starts the PAYMENT-PROCESSING state — the
 * screen polls the subscription read until the WEBHOOK flips the tier,
 * and never claims the new plan before the server does.
 *
 * No payment-method / invoice sections at beta: the BE exposes no
 * portal or invoice surface yet (D119's full layout lands with it).
 */
export function BillingScreen({ initialIntent = null }: { initialIntent?: BillingIntent | null }) {
  const { me } = useAuth();
  const { tier: meTier, cleanupRemaining } = useTier();
  const [processingFromTier, setProcessingFromTier] = useState<TierId | null>(null);
  const [processingSlow, setProcessingSlow] = useState(false);
  const subscriptionQuery = useBillingSubscription({
    refetchInterval: processingFromTier !== null ? PAYMENT_PROCESSING_POLL_MS : false,
  });
  const cancel = useCancelSubscription();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    void track('page_viewed', { page: 'billing', mailbox_id: me.activeMailboxId });
  }, [me.activeMailboxId]);

  const billingDisabled = isBillingDisabledError(subscriptionQuery.error);
  const data = subscriptionQuery.data ?? null;

  // While billing is dark the workspace tier still comes from `me`.
  const tier: TierId = data?.tier ?? meTier;
  const subscription = data?.subscription ?? null;

  // The webhook landed: the SERVER now reports a different tier than
  // the one checkout started from — only then is success claimed.
  useEffect(() => {
    if (processingFromTier === null || data === null) return;
    if (data.tier !== processingFromTier) {
      setProcessingFromTier(null);
      // Tier is a server-resolved scope and feature query keys are not
      // partitioned by it (§8 scope-change ⇒ cache-reset invariant) —
      // every cached read, gated 402 included, may now be stale. An
      // upgrade is a rare one-time event: reset everything, `me` first
      // so the app chrome's tier gates flip immediately.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void queryClient.invalidateQueries();
      toast(`Upgrade confirmed — you're on ${TIER_MANIFEST[data.tier].name}.`, 'success');
    }
  }, [processingFromTier, data, queryClient]);

  // "Usually within a minute" needs a state for when it isn't (§8 —
  // every promise in copy gets its elapsed branch).
  useEffect(() => {
    if (processingFromTier === null) {
      setProcessingSlow(false);
      return;
    }
    const timer = setTimeout(() => setProcessingSlow(true), PAYMENT_PROCESSING_SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [processingFromTier]);

  if (subscriptionQuery.isLoading) {
    return <LoadingState />;
  }
  // While a completed payment awaits its webhook, a transient poll
  // failure must NOT swap the screen for the error state — its "no
  // charge was made" copy would be false, and the poll self-heals.
  if (subscriptionQuery.isError && !billingDisabled && processingFromTier === null) {
    return (
      <BillingErrorState
        error={subscriptionQuery.error}
        onRetry={() => subscriptionQuery.refetch()}
      />
    );
  }

  function onPaymentCompleted() {
    setProcessingFromTier(tier);
    // Ask immediately — fast webhooks (sandbox flips in ~40s, some land
    // sooner) shouldn't wait a full poll interval.
    void subscriptionQuery.refetch();
  }

  function onConfirmCancel(reason: CancelRequest['reason']) {
    cancel.mutate(reason ? { reason } : {}, {
      onSuccess: (next) => {
        setCancelOpen(false);
        const end = formatBillingDate(next.subscription?.currentPeriodEnd ?? null);
        toast(
          end
            ? `Cancellation scheduled — your plan stays active until ${end}.`
            : 'Cancellation scheduled.',
          'success',
        );
        // No `billing_event` here — that event is webhook-only by
        // taxonomy rule (clients never claim subscription state); the
        // BE emits it when the provider confirms.
      },
    });
  }

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        maxWidth: 920,
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="billing"
        title="Plan & billing"
        body="Your plan, what it includes, and how it renews. Upgrades start today; cancellations take effect at the end of the period you've paid for."
        tip="Every paid plan includes a 30-day money-back guarantee, subject to the published Refund Policy and fair-use terms."
      />

      {billingDisabled ? <BillingDisabledNotice /> : null}

      {processingFromTier !== null ? <PaymentProcessingNotice slow={processingSlow} /> : null}

      {data?.foundingMember ? <FoundingBanner /> : null}

      <CurrentPlanCard
        tier={tier}
        subscription={subscription}
        cleanupRemaining={cleanupRemaining}
        billingDisabled={billingDisabled}
        onCancel={() => setCancelOpen(true)}
      />

      <PlanPicker
        currentTier={tier}
        hasActiveSubscription={subscription !== null && subscription.status !== 'canceled'}
        currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
        disabled={billingDisabled}
        initialIntent={initialIntent}
        onRequestCancel={() => setCancelOpen(true)}
        onPaymentCompleted={onPaymentCompleted}
      />

      <CancelModal
        open={cancelOpen}
        subscription={subscription}
        onClose={() => {
          setCancelOpen(false);
          // Clear a failed attempt so reopening the modal starts clean
          // (the mutation lives for the screen's lifetime, not the modal's).
          cancel.reset();
        }}
        onConfirm={onConfirmCancel}
        isCanceling={cancel.isPending}
        cancelError={cancel.error ? cancelErrorMessage(cancel.error) : null}
      />
    </div>
  );
}

/** Honest copy for a cancel failure — never a silent swallow. */
function cancelErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'There is no active subscription to cancel — refresh the page to see the current state.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'Billing isn’t switched on yet.';
  }
  return 'Cancellation could not be processed. Please try again.';
}

/**
 * The truthful post-checkout state (§10): the provider reported the
 * payment went through; the tier flips only when the webhook lands.
 * The screen polls underneath — no claim of the new plan is made here.
 * `slow` is the elapsed branch of "usually within a minute": still
 * honest, still polling, with a support escape hatch.
 */
export function PaymentProcessingNotice({ slow = false }: { slow?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="payment-processing-notice"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '12px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.md,
        fontSize: 13,
        lineHeight: 1.55,
        color: color.fg,
      }}
    >
      <span aria-hidden>⏳</span>
      {slow ? (
        <span>
          <strong style={{ fontWeight: 600 }}>
            Still confirming — this is taking longer than usual.
          </strong>{' '}
          <span style={{ color: color.fgSoft }}>
            Your payment went through and is safe; this page keeps checking automatically. If your
            plan hasn&rsquo;t updated in a few minutes, reload the page or email{' '}
            <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
              support@declutrmail.com
            </a>
            .
          </span>
        </span>
      ) : (
        <span>
          <strong style={{ fontWeight: 600 }}>Payment received — confirming your plan.</strong>{' '}
          <span style={{ color: color.fgSoft }}>
            The payment provider is finalizing your subscription. This page updates automatically,
            usually within a minute.
          </span>
        </span>
      )}
    </div>
  );
}

// ── Current plan card (D119 top block) ───────────────────────────────

function CurrentPlanCard({
  tier,
  subscription,
  cleanupRemaining,
  billingDisabled,
  onCancel,
}: {
  tier: TierId;
  subscription: BillingSubscription['subscription'];
  cleanupRemaining: number | null;
  billingDisabled: boolean;
  onCancel: () => void;
}) {
  const manifest = TIER_MANIFEST[tier];
  const note = subscription ? statusNote(subscription) : null;

  // Headline price: the active subscription's actual cycle price, or
  // the manifest monthly line for non-subscribed tiers (bare $0 for
  // Free — "/mo" on a forever-free plan reads like a charge).
  const priceLabel = subscription
    ? (planPriceLabel(subscription.tier, subscription.cycle) ?? '')
    : tier === 'free'
      ? formatUsd(0)
      : (planPriceLabel(tier, 'monthly') ?? formatUsd(0));
  const renewal =
    subscription && !subscription.cancelAtPeriodEnd
      ? formatBillingDate(subscription.currentPeriodEnd)
      : null;

  return (
    <section
      aria-label="Current plan"
      data-testid="current-plan-card"
      style={{
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Eyebrow>Current plan</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: font.display,
            fontSize: 24,
            fontWeight: 650,
            letterSpacing: '-0.015em',
            color: color.fg,
          }}
        >
          {manifest.name}
        </span>
        <span style={{ fontSize: 14, color: color.fgSoft, fontVariantNumeric: 'tabular-nums' }}>
          {priceLabel}
        </span>
        {renewal ? (
          <span style={{ fontSize: 13, color: color.fgMuted }}>· Next renewal {renewal}</span>
        ) : null}
        {subscription ? (
          <span style={{ fontSize: 13, color: color.fgMuted }}>
            · via {PROVIDER_LABELS[subscription.provider]}
          </span>
        ) : null}
      </div>

      {tier === 'free' ? (
        <p style={{ margin: 0, fontSize: 13, color: color.fgSoft }}>
          Free forever — no card on file.
          {cleanupRemaining !== null ? (
            <>
              {' '}
              <strong style={{ fontWeight: 600, color: color.fg }}>
                {cleanupRemaining} of {TIER_MANIFEST.free.cleanupActionsLifetime} lifetime cleanup
                actions left.
              </strong>
            </>
          ) : null}
        </p>
      ) : null}

      {note ? (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: note.tone === 'warn' ? color.amber : color.fgMuted,
          }}
        >
          {note.text}
        </p>
      ) : null}

      {!billingDisabled && canCancel(subscription) ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button tone="default" onClick={onCancel}>
            Cancel subscription
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Founding Pro banner (D119 / D126). Price straight off the manifest. */
function FoundingBanner() {
  const promo = TIER_MANIFEST.pro.promo;
  if (!promo) return null;
  return (
    <div
      data-testid="founding-banner"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '10px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.md,
        fontSize: 13,
        color: color.fg,
      }}
    >
      <span aria-hidden>🏛️</span>
      <span>
        <strong style={{ fontWeight: 650 }}>{promo.name} member</strong> — price locked at{' '}
        {formatUsd(promo.annual.usdCents)}/yr while your subscription stays active.
      </span>
    </div>
  );
}

/** The honest "billing is dark" designed state (not an error). */
function BillingDisabledNotice() {
  return (
    <div
      role="status"
      data-testid="billing-disabled-notice"
      style={{
        padding: '12px 14px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        fontSize: 13,
        lineHeight: 1.55,
        color: color.fgSoft,
      }}
    >
      <strong style={{ fontWeight: 600, color: color.fg }}>Billing isn&rsquo;t live yet.</strong>{' '}
      Checkout and subscription management open here once it is — the plans below are final, and
      nothing about your workspace changes until you choose one.
    </div>
  );
}

// ── Loading / error branches (D211/D212) ─────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 920,
      }}
    >
      {[120, 140].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 10,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading billing</span>
    </div>
  );
}

function BillingErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? `The request returned ${error.status}. ` : '';
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px clamp(12px, 4vw, 24px) 28px',
        fontFamily: font.sans,
      }}
    >
      <RecoverableErrorState
        title="We couldn't load your billing details"
        description={`${status}No charge or plan change was made. Try again in a moment.`}
        onRetry={onRetry}
      />
    </div>
  );
}
