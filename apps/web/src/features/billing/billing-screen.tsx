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
import type {
  BillingCycle,
  BillingSubscription,
  CancelRequest,
} from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { useAuth } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { useTier } from '@/features/auth/api/use-tier';
import { formatUsd } from '@/features/marketing/pricing/pricing-model';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';

import {
  apiErrorCode,
  isBillingDisabledError,
  useBillingSubscription,
} from './api/use-billing-subscription';
import { billingKeys } from './api/query-keys';
import type { BillingIntent } from './billing-intent';
import { useCancelSubscription } from './api/use-cancel-subscription';
import { useChangePlan } from './api/use-change-plan';
import { canCancel, formatBillingDate, planPriceLabel, statusNote } from './billing-model';
import { CancelModal } from './cancel-modal';
import { useResumeSubscription } from './api/use-resume-subscription';
import {
  clearPendingCheckout,
  pendingCheckoutKey,
  readPendingCheckout,
  writePendingCheckout,
  type PendingCheckout,
  type PendingKind,
} from './pending-checkout';
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
 * After this long the notice becomes the UNCONFIRMED state: checkout
 * stays locked (a silent unlock would reopen the double-charge window
 * for exactly the user whose webhook is delayed), the poll slows to
 * PAYMENT_UNCONFIRMED_POLL_MS, and the only releases are the tier flip
 * or the user confirming no charge actually went through.
 */
const PAYMENT_UNCONFIRMED_AFTER_MS = 15 * 60_000;
const PAYMENT_UNCONFIRMED_POLL_MS = 30_000;

/** How far along the webhook wait is — drives the notice + poll pace. */
type ProcessingPhase = 'fresh' | 'slow' | 'unconfirmed';

function processingPhaseAt(pending: PendingCheckout, now: number): ProcessingPhase {
  const elapsed = now - pending.at;
  if (elapsed >= PAYMENT_UNCONFIRMED_AFTER_MS) return 'unconfirmed';
  if (elapsed >= PAYMENT_PROCESSING_SLOW_AFTER_MS) return 'slow';
  return 'fresh';
}

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
  const workspaceId = me.user.workspaceId;
  // The pending payment lock. Persisted per workspace (localStorage) so
  // it survives reloads and reaches every tab of this browser — React
  // state alone is tab-local, and between checkout.completed and the
  // webhook grant nothing server-side can reject a second checkout.
  // Initialized null (SSR renders without storage) and hydrated from
  // storage on mount below. Cross-DEVICE remains a BE gap — flagged.
  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [processingPhase, setProcessingPhase] = useState<ProcessingPhase>('fresh');
  const subscriptionQuery = useBillingSubscription({
    refetchInterval:
      pending === null
        ? false
        : processingPhase === 'unconfirmed'
          ? PAYMENT_UNCONFIRMED_POLL_MS
          : PAYMENT_PROCESSING_POLL_MS,
  });
  const cancel = useCancelSubscription();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    void track('page_viewed', { page: 'billing', mailbox_id: me.activeMailboxId });
  }, [me.activeMailboxId]);

  // Hydrate the lock from storage (reload / late mount) and follow
  // writes from OTHER tabs — localStorage fires `storage` there, so a
  // payment completed in tab A locks (and later unlocks) tab B live.
  useEffect(() => {
    setPending(readPendingCheckout(workspaceId));
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== pendingCheckoutKey(workspaceId)) return;
      setPending(readPendingCheckout(workspaceId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [workspaceId]);

  const billingDisabled = isBillingDisabledError(subscriptionQuery.error);
  const data = subscriptionQuery.data ?? null;

  // While billing is dark the workspace tier still comes from `me`.
  const tier: TierId = data?.tier ?? meTier;
  const subscription = data?.subscription ?? null;

  // The webhook landed: the SERVER now reports a different tier — or,
  // for cycle-only plan changes, a different billing cycle — than the
  // action started from. Only then is success claimed.
  useEffect(() => {
    if (pending === null || data === null) return;
    const reachedTargetTier = data.tier === pending.toTier;
    const reachedTargetCycle =
      pending.toCycle === null ||
      (data.subscription !== null && data.subscription.cycle === pending.toCycle);
    if (reachedTargetTier && reachedTargetCycle) {
      clearPendingCheckout(workspaceId);
      setPending(null);
      // Tier is a server-resolved scope and feature query keys are not
      // partitioned by it (§8 scope-change ⇒ cache-reset invariant) —
      // every cached read, gated 402 included, may now be stale. A
      // plan change is a rare one-time event: reset everything, `me`
      // first so the app chrome's tier gates flip immediately.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void queryClient.invalidateQueries();
      toast(`Plan updated — you're on ${TIER_MANIFEST[data.tier].name}.`, 'success');
    }
  }, [pending, data, queryClient, workspaceId]);

  // "Usually within a minute" needs a state for when it isn't (§8 —
  // every promise in copy gets its elapsed branch). Elapsed counts
  // from the PAYMENT (pending.at), not from mount — a reload mid-wait
  // resumes with the true age. The lock itself never auto-expires;
  // only the copy and poll pace change.
  useEffect(() => {
    if (pending === null) {
      setProcessingPhase('fresh');
      return;
    }
    let timer: number | null = null;
    const advance = () => {
      const phase = processingPhaseAt(pending, Date.now());
      setProcessingPhase(phase);
      if (phase === 'unconfirmed') {
        timer = null;
        return;
      }
      const nextAt =
        pending.at +
        (phase === 'fresh' ? PAYMENT_PROCESSING_SLOW_AFTER_MS : PAYMENT_UNCONFIRMED_AFTER_MS);
      timer = window.setTimeout(advance, Math.max(0, nextAt - Date.now()));
    };
    advance();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [pending]);

  // The explicit, user-asserted release: "no charge went through".
  // The ONLY path out of the unconfirmed lock besides the tier flip —
  // never released on a timer (that would reopen the double-charge
  // window for exactly the user whose webhook is delayed).
  function onReleasePendingLock() {
    clearPendingCheckout(workspaceId);
    setPending(null);
  }

  if (subscriptionQuery.isLoading) {
    return <LoadingState />;
  }
  // While a completed payment awaits its webhook, a transient poll
  // failure must NOT swap the screen for the error state — its "no
  // charge was made" copy would be false, and the poll self-heals.
  if (subscriptionQuery.isError && !billingDisabled && pending === null) {
    return (
      <BillingErrorState
        error={subscriptionQuery.error}
        onRetry={() => subscriptionQuery.refetch()}
      />
    );
  }

  function startPending(
    kind: PendingKind,
    toTier: TierId,
    toCycle: BillingCycle | null,
    ownAttemptId?: string,
  ) {
    // No-clobber guard: the key is one per workspace, and an existing
    // change_unconfirmed record is an UNRESOLVED money outcome. It may
    // be overwritten only by the attempt that owns it — presenting its
    // exact id. Everything else (a completed checkout, an accepted
    // change, a resume, another attempt) must surface it, not replace
    // it: replacing would let a different flow's flip or single-step
    // release silently discard a maybe-charged state. Id-LESS
    // change_unconfirmed records (the surfaced/interrupted form) are
    // therefore absolutely protected here — their only exits are the
    // tier flip or the user's two-step assertion.
    const existing = readPendingCheckout(workspaceId);
    if (
      existing !== null &&
      existing.kind === 'change_unconfirmed' &&
      (existing.attemptId === undefined || existing.attemptId !== ownAttemptId)
    ) {
      setPending(existing);
    } else {
      setPending(
        writePendingCheckout(workspaceId, kind, tier, subscription?.cycle ?? null, toTier, toCycle),
      );
    }
    // Ask immediately — fast webhooks (sandbox flips in ~40s, some land
    // sooner) shouldn't wait a full poll interval.
    void subscriptionQuery.refetch();
  }

  /**
   * Pessimistic lock around the money-moving change-plan request: the
   * record is written BEFORE the request fires, so an unmount, reload,
   * or crash mid-flight leaves the lock in place (hydration re-locks on
   * the next mount) instead of leaving an armed retry. Deliberately no
   * `setPending` here — the in-flight tab keeps its normal isPending
   * spinner; only an interrupted/ambiguous outcome surfaces the lock.
   * Every KNOWN outcome clears or replaces the record: accepted →
   * `change`, scheduled → cleared, definitive/non-provider error →
   * cleared, ambiguous → `change_unconfirmed` becomes visible.
   */
  /**
   * Claim the pending slot at fire time. React's `disabled` prop can be
   * stale for the ms before this tab processes another tab's storage
   * event — so every money-capable action re-reads STORAGE at the
   * moment it fires. Any existing record (a payment awaiting its
   * webhook, an unresolved attempt, a surfaced ambiguity) refuses the
   * claim and gets surfaced instead.
   */
  function claimPendingSlot(): boolean {
    const existing = readPendingCheckout(workspaceId);
    if (existing !== null) {
      setPending(existing);
      return false;
    }
    return true;
  }

  function onPlanChangeAttempt(toTier: TierId, toCycle: BillingCycle | null): string | null {
    // The pessimistic write must never clobber an existing lock — this
    // is a brand-new attempt, so ANY record in the key is foreign.
    if (!claimPendingSlot()) return null;
    const attemptId = crypto.randomUUID();
    writePendingCheckout(
      workspaceId,
      'change_unconfirmed',
      tier,
      subscription?.cycle ?? null,
      toTier,
      toCycle,
      attemptId,
    );
    return attemptId;
  }

  /**
   * Release the attempt lock — but ONLY the lock this exact attempt
   * wrote. The record is one key per workspace (last-writer-wins) and
   * target/cycle matching is not unique (two attempts can share a
   * target), so release matches the attempt's UUID: a known outcome
   * never clears a lock some concurrent attempt re-wrote while this one
   * was in flight, and never a user-visible lock written by
   * startPending (those carry no attemptId — only the tier flip or the
   * user's explicit release clears them).
   */
  function releaseAttemptLock(attemptId: string) {
    const record = readPendingCheckout(workspaceId);
    if (record !== null && record.attemptId !== attemptId) return;
    clearPendingCheckout(workspaceId);
    setPending(null);
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
        body="Your plan, what it includes, and how it renews. Upgrades start today; downgrades and cancellations take effect after the period you've paid for."
        tip="Every paid plan includes a 30-day money-back guarantee, subject to the published Refund Policy and fair-use terms."
      />

      {billingDisabled ? <BillingDisabledNotice /> : null}

      {pending !== null ? (
        <PaymentProcessingNotice
          phase={processingPhase}
          kind={pending.kind}
          onRelease={onReleasePendingLock}
        />
      ) : null}

      {data?.foundingMember ? <FoundingBanner /> : null}

      <CurrentPlanCard
        tier={tier}
        subscription={subscription}
        cleanupRemaining={cleanupRemaining}
        billingDisabled={billingDisabled}
        onCancel={() => setCancelOpen(true)}
      />

      {subscription?.scheduledChange ? (
        <ScheduledPlanChangeNotice
          currentTier={subscription.tier}
          currentCycle={subscription.cycle}
          scheduledChange={subscription.scheduledChange}
          onCanceled={(next) => {
            queryClient.setQueryData(billingKeys.subscription(), next);
            toast('Keeping your current plan — confirming with Paddle.', 'success');
          }}
        />
      ) : null}

      {subscription?.status === 'paused' && !billingDisabled && pending === null ? (
        <PausedSubscriptionNotice
          subscription={subscription}
          currentTier={tier}
          onResumeStarted={() => startPending('resume', subscription.tier, subscription.cycle)}
          onRequestCancel={() => setCancelOpen(true)}
        />
      ) : null}

      <PlanPicker
        currentTier={tier}
        subscription={subscription}
        // While a plan action awaits its webhook, a second one could
        // double-charge — SUBSCRIPTION_EXISTS can't catch a checkout
        // whose row doesn't exist yet. Withhold every affordance until
        // the pending state resolves (the banner above says why).
        // Paused subs must resume or cancel first (the notice above).
        disabled={
          billingDisabled ||
          pending !== null ||
          subscription?.status === 'paused' ||
          subscription?.status === 'past_due' ||
          subscription?.cancelAtPeriodEnd === true ||
          subscription?.scheduledChange != null
        }
        initialIntent={initialIntent}
        onRequestCancel={() => setCancelOpen(true)}
        onPaymentCompleted={(target, cycle) => startPending('checkout', target, cycle)}
        onPlanChangeAttempt={onPlanChangeAttempt}
        claimPendingSlot={claimPendingSlot}
        onPlanChangeFailedKnown={releaseAttemptLock}
        onPlanChangeAccepted={(next, target, cycle, attemptId) => {
          const scheduled = next.subscription?.scheduledChange ?? null;
          if (scheduled) {
            // Scheduled ($0) — release this attempt's lock (UUID-
            // matched: never a concurrent attempt's unresolved lock).
            releaseAttemptLock(attemptId);
            queryClient.setQueryData(billingKeys.subscription(), next);
            const date = formatBillingDate(scheduled.effectiveAt);
            toast(date ? `Downgrade scheduled for ${date}.` : 'Downgrade scheduled.', 'success');
          } else {
            startPending('change', target, cycle, attemptId);
          }
        }}
        onPlanChangeUnconfirmed={(target, cycle, attemptId) =>
          // Ambiguous provider outcome on an immediate upgrade: the
          // prorated charge may have applied. Enter the SAME lock+poll
          // machinery as checkout — no stale panel with an armed
          // money-moving retry button.
          startPending('change_unconfirmed', target, cycle, attemptId)
        }
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
 * Phases: `fresh` ("usually within a minute") → `slow` (elapsed branch
 * with a support escape hatch) → `unconfirmed` (checkout stays locked;
 * the ONLY releases are the tier flip or the user asserting via
 * `onRelease` that no charge actually went through — an automatic
 * unlock would reopen the double-charge window).
 */
export function PaymentProcessingNotice({
  phase = 'fresh',
  kind = 'checkout',
  onRelease,
}: {
  phase?: 'fresh' | 'slow' | 'unconfirmed';
  /** What started the wait — a new checkout payment, a plan change on
   *  the existing subscription, or a pause resume. The copy must state
   *  only what actually happened (a plan change/resume made no new
   *  overlay payment). */
  kind?: PendingKind;
  /** User-asserted "no charge went through" release (unconfirmed only).
   *  Reached only through the two-step confirm below — a wrong release
   *  invites a second charge, so the risk is stated before the act
   *  (the D226 preview-before-consequence shape). */
  onRelease?: () => void;
}) {
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  // What the provider acknowledged — the factual anchor per kind.
  // `change_unconfirmed` acknowledges NOTHING: the provider's response
  // was lost, so every claim below stays outcome-neutral for it.
  const acted =
    kind === 'checkout'
      ? 'Payment received'
      : kind === 'change'
        ? 'Plan change accepted'
        : kind === 'change_unconfirmed'
          ? 'Plan change unconfirmed'
          : 'Resume accepted';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="payment-processing-notice"
      style={{
        display: 'flex',
        flexDirection: 'column',
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
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span aria-hidden>⏳</span>
        {phase === 'unconfirmed' ? (
          <span>
            <strong style={{ fontWeight: 600 }}>
              {acted} — your plan change hasn&rsquo;t come through yet.
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              The provider&rsquo;s confirmation hasn&rsquo;t reached our server, so plan changes
              stay paused — starting another could charge you twice. Waiting is always safe: this
              page keeps checking, and your plan updates the moment the confirmation arrives. Email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
                support@declutrmail.com
              </a>{' '}
              and we&rsquo;ll sort it out.
            </span>
          </span>
        ) : phase === 'slow' ? (
          <span>
            <strong style={{ fontWeight: 600 }}>
              Still confirming — this is taking longer than usual.
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              {kind === 'checkout'
                ? 'Your payment went through and is safe; this page keeps checking automatically.'
                : kind === 'change_unconfirmed'
                  ? 'The change may or may not have applied; this page keeps checking automatically.'
                  : 'The provider accepted the change; this page keeps checking automatically.'}{' '}
              If your plan hasn&rsquo;t updated in a few minutes, reload the page or email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
                support@declutrmail.com
              </a>
              .
            </span>
          </span>
        ) : (
          <span>
            <strong style={{ fontWeight: 600 }}>{acted} — confirming your plan.</strong>{' '}
            <span style={{ color: color.fgSoft }}>
              {kind === 'resume'
                ? 'No charge was started; your existing paid period continues.'
                : kind === 'change_unconfirmed'
                  ? 'The payment provider didn’t confirm your upgrade — it may or may not have gone through. If it did, your plan updates here and nothing further is needed.'
                  : 'The payment provider is finalizing your subscription.'}{' '}
              This page updates automatically, usually within a minute.
            </span>
          </span>
        )}
      </span>
      {phase === 'unconfirmed' && onRelease ? (
        kind === 'checkout' || kind === 'change_unconfirmed' ? (
          // A payment happened (checkout) or MAY have (unconfirmed
          // change) — release needs an explicit user assertion, never
          // one click.
          confirmingRelease ? (
            <div
              data-testid="release-confirm"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <p style={{ margin: 0, fontSize: 12.5, color: color.fg }}>
                {kind === 'checkout' ? (
                  <>
                    <strong style={{ fontWeight: 600 }}>Before resuming, check for a charge</strong>{' '}
                    — a card statement entry or a Paddle receipt email. If the payment did go
                    through and you check out again, you could be charged twice. Resuming
                    doesn&rsquo;t cancel the earlier payment.
                  </>
                ) : (
                  <>
                    <strong style={{ fontWeight: 600 }}>
                      Before retrying, check your plan and your card
                    </strong>{' '}
                    — if the upgrade actually went through, it shows here shortly and no retry is
                    needed. Starting a different change on top of an applied one can move money
                    again.
                  </>
                )}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button tone="default" onClick={() => setConfirmingRelease(false)}>
                  Keep waiting
                </Button>
                <Button tone="danger" onClick={onRelease}>
                  {kind === 'checkout'
                    ? 'I checked — no charge. Resume checkout'
                    : 'I checked — nothing applied. Let me retry'}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button tone="default" onClick={() => setConfirmingRelease(true)}>
                {kind === 'checkout'
                  ? 'No charge went through — resume checkout'
                  : 'The change didn’t apply — let me retry'}
              </Button>
            </div>
          )
        ) : (
          // Accepted change / resume locks carry no new-payment risk —
          // re-applying the same change is a provider no-op — so a
          // single explicit release is enough.
          <div>
            <Button tone="default" onClick={onRelease}>
              Stop waiting — let me try again
            </Button>
          </div>
        )
      ) : null}
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

  // The card tells ONE story: the ENTITLEMENT tier. Subscription
  // details (its price, renewal, status, cancel affordance) render
  // only when the subscription actually BACKS that tier — a paused or
  // mismatched row must never leak its price or status onto a Free
  // card ("Free · $9/mo · paused" asserted three incoherent facts).
  const subBacksTier =
    subscription !== null &&
    subscription.tier === tier &&
    (subscription.status === 'active' || subscription.status === 'past_due');
  const note = subBacksTier ? statusNote(subscription) : null;

  // Headline price: the backing subscription's actual cycle price, or
  // the manifest monthly line otherwise (bare $0 for Free — "/mo" on a
  // forever-free plan reads like a charge).
  const priceLabel = subBacksTier
    ? (planPriceLabel(subscription.tier, subscription.cycle) ?? '')
    : tier === 'free'
      ? formatUsd(0)
      : (planPriceLabel(tier, 'monthly') ?? formatUsd(0));
  const renewal =
    subBacksTier && !subscription.cancelAtPeriodEnd
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

      {!billingDisabled && subBacksTier && canCancel(subscription) ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button tone="default" onClick={onCancel}>
            Cancel subscription
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ScheduledPlanChangeNotice({
  currentTier,
  currentCycle,
  scheduledChange,
  onCanceled,
}: {
  currentTier: 'plus' | 'pro';
  currentCycle: BillingCycle;
  scheduledChange: NonNullable<NonNullable<BillingSubscription['subscription']>['scheduledChange']>;
  onCanceled: (next: BillingSubscription) => void;
}) {
  const changePlan = useChangePlan();
  const effectiveDate = formatBillingDate(scheduledChange.effectiveAt);
  const targetName = TIER_MANIFEST[scheduledChange.tier].name;
  const confirming = scheduledChange.state !== 'scheduled';
  const restoring = scheduledChange.state === 'restoring_current';
  return (
    <div
      role="status"
      data-testid="scheduled-plan-change-notice"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.md,
        fontSize: 13,
        lineHeight: 1.55,
        color: color.fg,
      }}
    >
      <strong style={{ fontWeight: 600 }}>
        {restoring
          ? 'Keeping your current plan'
          : confirming
            ? 'Confirming your downgrade'
            : 'Downgrade scheduled'}
        {effectiveDate ? ` for ${effectiveDate}` : ''}.
      </strong>
      <span style={{ color: color.fgSoft }}>
        {restoring ? (
          <>
            We&rsquo;re confirming your request to keep {TIER_MANIFEST[currentTier].name}. Your
            current access remains available while Paddle&rsquo;s billing outcome is unconfirmed.
          </>
        ) : confirming ? (
          <>
            Your request to move to {targetName} ({scheduledChange.cycle}) was recorded, but the
            payment provider hasn&rsquo;t confirmed it yet. Your {TIER_MANIFEST[currentTier].name}{' '}
            features stay active, and this request itself charges $0.
          </>
        ) : (
          <>
            Your {TIER_MANIFEST[currentTier].name} features stay active through the current paid
            period. Then you&rsquo;ll move to {targetName} ({scheduledChange.cycle}). $0 is due
            today, and there is no refund or credit for the current period.
          </>
        )}
      </span>
      {confirming ? (
        <span style={{ color: color.fgMuted, fontSize: 12 }}>
          {restoring
            ? 'Paddle has not confirmed whether your renewal was restored. Retry before renewal or contact support.'
            : 'The payment provider’s response was interrupted, so billing changes are locked while we reconcile it.'}{' '}
          {restoring ? '' : 'Your current plan and renewal remain unchanged. '}Email{' '}
          <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
            support@declutrmail.com
          </a>{' '}
          if this does not settle shortly.
        </span>
      ) : null}
      <div>
        <Button
          tone="default"
          disabled={changePlan.isPending}
          onClick={() =>
            changePlan.mutate(
              { tierId: currentTier, cycle: currentCycle },
              { onSuccess: onCanceled },
            )
          }
        >
          {changePlan.isPending
            ? 'Keeping current plan…'
            : restoring
              ? 'Retry keeping current plan'
              : 'Keep current plan instead'}
        </Button>
      </div>
      {changePlan.error ? (
        <span role="alert" style={{ color: color.red, fontSize: 12 }}>
          The payment provider didn&rsquo;t confirm the cancellation — it may or may not have
          registered. This page reflects the confirmed state; retry, or email
          support@declutrmail.com if it repeats.
        </span>
      ) : null}
    </div>
  );
}

/**
 * A paused subscription's designed state: the two real exits — resume
 * it (webhook restores the tier) or cancel it. Plan changes stay
 * locked while paused (the BE rejects them with SUBSCRIPTION_PAUSED).
 * Copy states only server facts: the entitlement tier comes from the
 * subscription READ (`currentTier`), never assumed to be Free.
 */
function PausedSubscriptionNotice({
  subscription,
  currentTier,
  onResumeStarted,
  onRequestCancel,
}: {
  subscription: NonNullable<BillingSubscription['subscription']>;
  /** The workspace's server-resolved entitlement tier. */
  currentTier: TierId;
  onResumeStarted: () => void;
  onRequestCancel: () => void;
}) {
  const resume = useResumeSubscription();
  const [confirmingResume, setConfirmingResume] = useState(false);
  const tierName = TIER_MANIFEST[subscription.tier].name;
  const until = formatBillingDate(subscription.pauseUntil);
  const retainedPeriodEnd = formatBillingDate(subscription.currentPeriodEnd);
  // Self-serve resume promises "$0 today, existing period continues" —
  // only render that promise when the retained period is actually known
  // (ui-truth: never assert a period the read can't confirm).
  const canSelfServeResume = subscription.provider === 'paddle' && retainedPeriodEnd !== null;
  return (
    <div
      role="status"
      data-testid="paused-subscription-notice"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        fontSize: 13,
        lineHeight: 1.55,
        color: color.fg,
      }}
    >
      <span>
        <strong style={{ fontWeight: 600 }}>
          Your {tierName} subscription is paused{until ? ` until ${until}` : ''}.
        </strong>{' '}
        <span style={{ color: color.fgSoft }}>
          While it&rsquo;s paused you aren&rsquo;t billed, and your workspace is on{' '}
          {TIER_MANIFEST[currentTier].name}. Resume to reactivate {tierName}, or cancel if
          you&rsquo;re done with it.
        </span>
      </span>
      {!canSelfServeResume ? (
        <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft }}>
          {subscription.provider === 'razorpay'
            ? 'Razorpay does not guarantee a no-charge resume on the existing billing period. To avoid an unexpected charge, email '
            : 'We can’t confirm your retained billing period from here, so resume isn’t offered without review. Email '}
          <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
            support@declutrmail.com
          </a>{' '}
          and we&rsquo;ll help reactivate it safely.
        </p>
      ) : null}
      {resume.error ? (
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
          {apiErrorCode(resume.error) === 'RESUME_PERIOD_ENDED'
            ? 'Your retained billing period has ended. Nothing was charged. Email support@declutrmail.com to reactivate with a new paid period.'
            : 'The payment provider didn’t confirm the resume. Resume starts no new charge either way — try again, or email support@declutrmail.com.'}
        </div>
      ) : null}
      {confirmingResume && canSelfServeResume ? (
        <div
          data-testid="resume-confirm-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: radius.md,
          }}
        >
          <strong style={{ fontWeight: 600 }}>Resume without starting a new billing period</strong>
          <span style={{ color: color.fgSoft }}>
            $0 is due today. Your existing paid period continues through {retainedPeriodEnd}; plan
            and billing changes take effect from the next billing period. If that retained period
            has already ended, resume will stop safely instead of starting a new charge.
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              tone="primary"
              disabled={resume.isPending}
              onClick={() =>
                resume.mutate(undefined, {
                  onSuccess: () => onResumeStarted(),
                })
              }
            >
              {resume.isPending ? 'Resuming…' : `Confirm resume ${tierName}`}
            </Button>
            <Button
              tone="default"
              disabled={resume.isPending}
              onClick={() => setConfirmingResume(false)}
            >
              Keep paused
            </Button>
          </div>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canSelfServeResume && !confirmingResume ? (
          <Button tone="primary" onClick={() => setConfirmingResume(true)}>
            Review resume
          </Button>
        ) : null}
        <Button tone="default" onClick={onRequestCancel} disabled={resume.isPending}>
          Cancel subscription
        </Button>
      </div>
    </div>
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
