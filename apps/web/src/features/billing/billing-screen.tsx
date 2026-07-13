'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

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
import { useTier } from '@/features/auth/api/use-tier';
import { formatUsd, priceLineFor } from '@/features/marketing/pricing/pricing-model';
import { TIER_JOBS } from '@/features/marketing/pricing/pricing-model';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';

import { isBillingDisabledError, useBillingSubscription } from './api/use-billing-subscription';
import { billingIntentPath, type BillingIntent } from './billing-intent';
import { useCancelSubscription } from './api/use-cancel-subscription';
import {
  canCancel,
  formatBillingDate,
  MONEY_BACK_NOTE,
  planPriceLabel,
  PROVIDER_LABELS,
  statusNote,
  STRIP_TIER_IDS,
} from './billing-model';
import { CancelModal } from './cancel-modal';
import { PlanChangeModal } from './plan-change-modal';

const { color, font, radius, shadow } = tokens;

/**
 * Billing screen (D119) — current-plan card + condensed 3-tier strip +
 * link to /pricing, with the D120 change/cancel flows behind modals.
 *
 * Tier source of truth: while billing is DARK (503 BILLING_DISABLED —
 * the F-queue hasn't flipped `BILLING_ENABLED`), the plan card renders
 * from `/api/auth/me`'s tier and the screen states honestly that
 * subscription management isn't live yet (a designed state, never an
 * error toast). Once billing is live, `GET /api/billing/subscription`
 * is authoritative (it also carries the founding flag + provider
 * record the `me` payload doesn't).
 *
 * No payment-method / invoice sections at beta: the BE exposes no
 * portal or invoice surface yet (D119's full layout lands with it).
 */
export function BillingScreen({ initialIntent = null }: { initialIntent?: BillingIntent | null }) {
  const { me } = useAuth();
  const { tier: meTier, cleanupRemaining } = useTier();
  const subscriptionQuery = useBillingSubscription();
  const cancel = useCancelSubscription();
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const handledIntent = useRef<string | null>(null);

  useEffect(() => {
    void track('page_viewed', { page: 'billing', mailbox_id: me.activeMailboxId });
  }, [me.activeMailboxId]);

  const billingDisabled = isBillingDisabledError(subscriptionQuery.error);
  const data = subscriptionQuery.data ?? null;
  const intentKey = initialIntent ? billingIntentPath(initialIntent) : null;

  // A paid CTA lands here with an exact plan/cycle selection. Wait for
  // the authoritative billing read before opening checkout; a disabled
  // or failed billing backend keeps the honest designed state visible.
  useEffect(() => {
    if (!intentKey || !subscriptionQuery.isSuccess || handledIntent.current === intentKey) return;
    handledIntent.current = intentKey;
    setPlanChangeOpen(true);
  }, [intentKey, subscriptionQuery.isSuccess]);

  // While billing is dark the workspace tier still comes from `me`.
  const tier: TierId = data?.tier ?? meTier;
  const subscription = data?.subscription ?? null;

  if (subscriptionQuery.isLoading) {
    return <LoadingState />;
  }
  if (subscriptionQuery.isError && !billingDisabled) {
    return (
      <BillingErrorState
        error={subscriptionQuery.error}
        onRetry={() => subscriptionQuery.refetch()}
      />
    );
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

      {data?.foundingMember ? <FoundingBanner /> : null}

      <CurrentPlanCard
        tier={tier}
        subscription={subscription}
        cleanupRemaining={cleanupRemaining}
        billingDisabled={billingDisabled}
        onChangePlan={() => setPlanChangeOpen(true)}
        onCancel={() => setCancelOpen(true)}
      />

      <TierStrip currentTier={tier} />

      <PlanChangeModal
        open={planChangeOpen}
        initialIntent={initialIntent}
        currentTier={tier}
        hasActiveSubscription={subscription !== null && subscription.status !== 'canceled'}
        currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
        onClose={() => setPlanChangeOpen(false)}
        onRequestCancel={() => setCancelOpen(true)}
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

// ── Current plan card (D119 top block) ───────────────────────────────

function CurrentPlanCard({
  tier,
  subscription,
  cleanupRemaining,
  billingDisabled,
  onChangePlan,
  onCancel,
}: {
  tier: TierId;
  subscription: BillingSubscription['subscription'];
  cleanupRemaining: number | null;
  billingDisabled: boolean;
  onChangePlan: () => void;
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

      {billingDisabled ? null : (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button tone="primary" onClick={onChangePlan}>
            Change plan
          </Button>
          {canCancel(subscription) ? (
            <Button tone="default" onClick={onCancel}>
              Cancel subscription
            </Button>
          ) : null}
        </div>
      )}
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

// ── Condensed 3-tier strip (D119 middle block) ───────────────────────

function TierStrip({ currentTier }: { currentTier: TierId }) {
  return (
    <section
      aria-label="Compare plans"
      style={{
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <Eyebrow>Compare plans</Eyebrow>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {STRIP_TIER_IDS.map((id) => {
          const tier = TIER_MANIFEST[id];
          const price = priceLineFor(tier, 'monthly');
          const isCurrent = id === currentTier;
          return (
            <div
              key={id}
              data-testid={`tier-strip-${id}`}
              style={{
                flex: '1 1 160px',
                padding: '12px 14px',
                background: isCurrent ? color.primarySoft : color.paper,
                border: `1px solid ${isCurrent ? color.primaryBorder : color.line}`,
                borderRadius: radius.md,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 650, color: color.fg }}>
                  {id === 'pro' ? '⭐ ' : ''}
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
              <span style={{ fontSize: 13, color: color.fg, fontVariantNumeric: 'tabular-nums' }}>
                {price ? `${price.amount}${price.per}` : '—'}
              </span>
              <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.4 }}>
                {TIER_JOBS[id]}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
