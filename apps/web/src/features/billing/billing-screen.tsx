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
  BillingProviderId,
  BillingReconcileOutcome,
  BillingSubscription,
  CancelRequest,
} from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { useAuth } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { useTier } from '@/features/auth/api/use-tier';
import { currencyForProvider, formatMoney } from '@/features/marketing/pricing/pricing-model';
import { ApiError, apiDelete } from '@/lib/api/client';
import { track } from '@/lib/posthog';

import { apiErrorCode, useBillingSubscription } from './api/use-billing-subscription';
import { billingKeys } from './api/query-keys';
import type { BillingIntent } from './billing-intent';
import { useCancelSubscription } from './api/use-cancel-subscription';
import { useChangePlan } from './api/use-change-plan';
import { useReconcileCheckout } from './api/use-reconcile-checkout';
import {
  backingStatusNote,
  currentPlanPriceLabel,
  deriveBillingViewState,
  emptyPlanView,
  formatBillingDate,
  nonBackingBlocksNewCheckout,
  type BillingPlanView,
  type NonBackingRecord,
} from './billing-model';
import { CancelModal } from './cancel-modal';
import { usePauseSubscription } from './api/use-pause-subscription';
import { useResumeCancellation } from './api/use-resume-cancellation';
import { useResumeSubscription } from './api/use-resume-subscription';
import {
  clearPendingCheckout,
  pendingCheckoutKey,
  readPendingCheckout,
  withMoneyActionMutex,
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
export function BillingScreen({
  initialIntent = null,
  initialProvider = 'paddle',
}: {
  initialIntent?: BillingIntent | null;
  /** Geo-derived default rail (D117); the radio still overrides it. */
  initialProvider?: BillingProviderId;
}) {
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
  const resumeCancellation = useResumeCancellation();
  const pause = usePauseSubscription();
  const reconcileCheckout = useReconcileCheckout();
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

  const data = subscriptionQuery.data ?? null;

  // 0051 cross-device lock: the SERVER's pending-checkout signal covers
  // the device that did NOT run the checkout (localStorage is
  // same-browser only — laptop pays, phone opens /billing). When the
  // server says a checkout is in flight and this browser holds no
  // local lock, synthesize one: the existing processing state machine
  // (banner + poll + unlock-on-tier-flip) then runs unchanged. The
  // local lock stays authoritative when present — it carries the
  // richer fromTier/kind context the server row doesn't.
  const serverPending = data?.pendingCheckout ?? null;
  useEffect(() => {
    if (!serverPending || pending !== null || data === null) return;
    if (Date.parse(serverPending.expiresAt) <= Date.now()) return;
    setPending({
      workspaceId,
      // 'checkout_intent', NOT 'checkout': the server row proves a
      // checkout was OPENED and is unresolved — not that a payment was
      // received. The intent anchor renders "Checkout started", which
      // is all this browser actually knows (Codex 2026-07-29 — the
      // synthesized banner previously overclaimed "Payment received").
      kind: 'checkout_intent',
      // TierId is the purchasable ladder; team/enterprise never checkout.
      fromTier: data.tier === 'plus' || data.tier === 'pro' ? data.tier : 'free',
      fromCycle: data.subscription?.cycle ?? null,
      // The server row names what the checkout is buying — the flip
      // detector unlocks the moment the workspace reaches it.
      toTier: serverPending.tier,
      toCycle: serverPending.cycle,
      at: Date.now(),
    });
    // Deliberately NOT written to localStorage: the server row is the
    // source; a synthesized local copy would outlive it and re-lock
    // after the server cleared.
  }, [serverPending, pending, data, workspaceId]);

  // A6 — the ONE interpretation of the billing read. Every rendered
  // surface derives from `view`; no component reads the raw
  // subscription row for plan facts anymore
  // (docs/adr/0027-billing-presentation-state.md).
  const view = deriveBillingViewState({
    isLoading: subscriptionQuery.isLoading,
    isError: subscriptionQuery.isError,
    error: subscriptionQuery.error,
    data: subscriptionQuery.data,
    meTier,
    pending,
  });

  // Pending-lock BOOKKEEPING (not render): the lock records the exact
  // server tier/cycle a money action started from, so it still reads
  // the raw body (while billing is dark the tier comes from `me`).
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
    // Release the SERVER claim too (0051) — without this, the local
    // release re-arms this browser while CHECKOUT_IN_FLIGHT still
    // refuses the retry for up to 30 minutes, and other devices keep
    // showing the processing banner. Best-effort: a failed release
    // self-heals at the TTL, and the retry checkout's error message
    // names this control as the way out.
    void apiDelete<{ released: true }>('/api/billing/checkout/pending')
      .then(() => queryClient.invalidateQueries({ queryKey: billingKeys.subscription() }))
      .catch(() => undefined);
  }

  if (view.kind === 'loading') {
    return <LoadingState />;
  }
  // The derive layer already kept a pending money action out of this
  // state: while a completed payment awaits its webhook, a transient
  // poll failure must NOT swap the screen for the error state — its
  // "no charge was made" copy would be false, and the poll self-heals.
  if (view.kind === 'read_failed') {
    return <BillingErrorState onRetry={() => subscriptionQuery.refetch()} />;
  }
  // Malformed 200 body — honest ignorance, never TIER_MANIFEST[garbage].
  if (view.kind === 'unknown') {
    return <BillingUnknownState onRetry={() => subscriptionQuery.refetch()} />;
  }

  function startPending(
    kind: PendingKind,
    toTier: TierId,
    toCycle: BillingCycle | null,
    ownAttemptId?: string,
  ) {
    // No-clobber guard: the key is one per workspace. An id-CARRYING
    // record (a change attempt or a checkout reservation) may be
    // overwritten only by the flow that owns it — presenting its exact
    // id. An id-LESS change_unconfirmed record (the surfaced or
    // interrupted form) is absolutely protected: replacing an
    // unresolved money outcome would let a different flow's flip or
    // single-step release silently discard a maybe-charged state.
    // Their only exits are the tier flip or the user's two-step
    // assertion.
    const existing = readPendingCheckout(workspaceId);
    if (
      existing !== null &&
      (existing.attemptId !== undefined
        ? existing.attemptId !== ownAttemptId
        : existing.kind === 'change_unconfirmed')
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
   * Atomic claim + pessimistic RESERVATION in one mutex hold — a
   * brand-new money action may only write into a verified-empty slot;
   * concurrent tabs serialize here instead of both observing "no
   * lock". The reservation is written BEFORE any request fires or
   * overlay opens, so an unmount, reload, or crash mid-flight leaves
   * the lock in place (hydration re-locks on the next mount).
   * Deliberately no `setPending` — the in-flight tab keeps its normal
   * spinner; only an interrupted/ambiguous outcome surfaces the lock.
   * Kinds by path: change attempts write `change_unconfirmed` (the
   * request itself moves money; accepted → `change`, scheduled/known
   * failure → released, ambiguous → surfaced); fresh checkouts write
   * `checkout_intent` (the overlay is the payment surface; completed →
   * `checkout`, closed-without-payment/launch failure → released,
   * interrupted → surfaced outcome-neutral).
   */
  async function attemptClaim(
    kind: PendingKind,
    toTier: TierId,
    toCycle: BillingCycle | null,
  ): Promise<string | null> {
    const claim = await withMoneyActionMutex(workspaceId, () => {
      const existing = readPendingCheckout(workspaceId);
      if (existing !== null) {
        setPending(existing);
        return null;
      }
      const attemptId = crypto.randomUUID();
      writePendingCheckout(
        workspaceId,
        kind,
        tier,
        subscription?.cycle ?? null,
        toTier,
        toCycle,
        attemptId,
      );
      return attemptId;
    });
    return claim.acquired ? (claim.result ?? null) : null;
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

  /**
   * Surface (NOT release) this attempt's lock: `checkout.closed`
   * without a completed event is strong evidence of no payment, but
   * not proof — PayPal-popup/3DS edges can settle a charge after the
   * overlay closes. The reservation stays, becomes visible with
   * outcome-neutral copy, and polls; the user re-arms checkout through
   * the immediate two-step "I checked — no charge" release, and a
   * late-settling payment auto-clears via the tier flip.
   */
  function surfaceAttemptLock(attemptId: string) {
    const record = readPendingCheckout(workspaceId);
    if (record !== null && record.attemptId === attemptId) {
      setPending(record);
      void subscriptionQuery.refetch();
    }
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

  // Remaining kinds: billing_dark | payment_pending | plan — all render
  // the plan layout. Billing-dark carries no read body, so its plan
  // payload is the honest empty view over the `me` entitlement.
  const billingDark = view.kind === 'billing_dark';
  const plan: BillingPlanView = billingDark ? emptyPlanView(view.entitlementTier) : view;
  const backingSub = plan.backing.state === 'none' ? null : plan.backing.sub;
  // The picker's change-vs-checkout routing rides the BACKING record in
  // a granting status only (cancel_scheduled locks the picker anyway).
  const grantingBackingSub =
    plan.backing.state === 'active' || plan.backing.state === 'past_due' ? plan.backing.sub : null;
  // The non-backing notice renders only in the settled plan state — a
  // pending money action's banner owns the screen's story until the
  // webhook resolves it, and billing-dark has no rows to describe.
  const nonBacking = view.kind === 'plan' ? plan.nonBacking : null;

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

      {billingDark ? <BillingDisabledNotice /> : null}

      {pending !== null ? (
        <PaymentProcessingNotice
          phase={processingPhase}
          kind={pending.kind}
          onRelease={onReleasePendingLock}
          onProviderCheck={
            // D249 — checkout-shaped waits run the pending-checkout
            // ladder; a change wait asks about the workspace's LIVE
            // subscriptions instead (an immediate upgrade leaves no
            // claim row, and the checkout ladder would call a charged
            // upgrade "no payment found"). Resume waits stay un-checked.
            pending.kind === 'checkout' || pending.kind === 'checkout_intent'
              ? async () => {
                  const outcome = await reconcileCheckout.mutateAsync({
                    // The local record as the hint — load-bearing once
                    // the server claim has TTL'd and been swept (the
                    // stale-lock case): the server can still search
                    // the provider for what THIS browser awaited.
                    ...(pending.toTier === 'plus' || pending.toTier === 'pro'
                      ? { toTier: pending.toTier }
                      : {}),
                    ...(pending.toCycle ? { cycle: pending.toCycle } : {}),
                    startedAt: new Date(pending.at).toISOString(),
                  });
                  if (outcome === 'granted' || outcome === 'already_recorded') {
                    // The projection (or an earlier webhook) already
                    // wrote the truth — pull it; the tier flip clears
                    // this notice through the normal detector.
                    void subscriptionQuery.refetch();
                  }
                  return outcome;
                }
              : pending.kind === 'change' || pending.kind === 'change_unconfirmed'
                ? async () => {
                    const outcome = await reconcileCheckout.mutateAsync({
                      kind: 'change',
                      // The awaited target — the server uses it to split
                      // "unchanged" into recorded-confirmation vs
                      // change-never-happened. Without it, "no change at
                      // the provider" would read as "Confirmed".
                      ...(pending.toTier === 'plus' || pending.toTier === 'pro'
                        ? { toTier: pending.toTier }
                        : {}),
                      ...(pending.toCycle ? { cycle: pending.toCycle } : {}),
                      startedAt: new Date(pending.at).toISOString(),
                    });
                    if (outcome === 'granted' || outcome === 'already_recorded') {
                      void subscriptionQuery.refetch();
                    }
                    return outcome;
                  }
                : undefined
          }
        />
      ) : null}

      {plan.foundingMember && backingSub ? <FoundingBanner provider={backingSub.provider} /> : null}

      <CurrentPlanCard
        plan={plan}
        cleanupRemaining={cleanupRemaining}
        billingDark={billingDark}
        onCancel={() => setCancelOpen(true)}
        onResumeCancellation={() =>
          resumeCancellation.mutate(undefined, {
            onSuccess: (next) => {
              const end = formatBillingDate(next.subscription?.currentPeriodEnd ?? null);
              toast(
                end ? `Subscription restored — it renews on ${end}.` : 'Subscription restored.',
                'success',
              );
            },
          })
        }
        isResumingCancellation={resumeCancellation.isPending}
        resumeCancellationError={
          resumeCancellation.error ? resumeCancellationErrorMessage(resumeCancellation.error) : null
        }
      />

      {plan.scheduledChange && backingSub ? (
        <ScheduledPlanChangeNotice
          currentTier={backingSub.tier}
          currentCycle={backingSub.cycle}
          scheduledChange={plan.scheduledChange}
          onCanceled={(next) => {
            queryClient.setQueryData(billingKeys.subscription(), next);
            toast('Keeping your current plan — confirming with Paddle.', 'success');
          }}
        />
      ) : null}

      {nonBacking ? (
        <NonBackingSubscriptionNotice
          record={nonBacking}
          entitlementTier={plan.entitlementTier}
          onResumeStarted={() => startPending('resume', nonBacking.sub.tier, nonBacking.sub.cycle)}
          onRequestCancel={() => setCancelOpen(true)}
        />
      ) : null}

      <PlanPicker
        currentTier={plan.entitlementTier}
        grantingSub={grantingBackingSub}
        // While a plan action awaits its webhook, a second one could
        // double-charge — SUBSCRIPTION_EXISTS can't catch a checkout
        // whose row doesn't exist yet. Withhold every affordance until
        // the pending state resolves (the banner above says why).
        // A non-backing row that is not CANCELED still occupies the
        // server's one-live-subscription slot (SUBSCRIPTION_EXISTS keys
        // on STATUS active/past_due/paused, not on backing) — offering
        // checkout against it is a guaranteed 409 dead-end. Resume or
        // cancel first; the notice above carries those verbs (A6).
        disabled={
          billingDark ||
          pending !== null ||
          plan.backing.state === 'past_due' ||
          plan.backing.state === 'cancel_scheduled' ||
          plan.scheduledChange != null ||
          nonBackingBlocksNewCheckout(nonBacking)
        }
        initialIntent={initialIntent}
        initialProvider={initialProvider}
        onRequestCancel={() => setCancelOpen(true)}
        onPaymentCompleted={(target, cycle, attemptId) =>
          // Own-id transition over this checkout's reservation: the
          // overlay reported payment — the record becomes the visible
          // "Payment received" lock+poll.
          startPending('checkout', target, cycle, attemptId)
        }
        onCheckoutAttempt={(target, cycle) => attemptClaim('checkout_intent', target, cycle)}
        onCheckoutAbandoned={releaseAttemptLock}
        onCheckoutClosed={surfaceAttemptLock}
        onPlanChangeAttempt={(target, cycle) => attemptClaim('change_unconfirmed', target, cycle)}
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
        sub={backingSub ?? plan.nonBacking?.sub ?? null}
        backsEntitlement={backingSub !== null}
        entitlementTier={plan.entitlementTier}
        onClose={() => {
          setCancelOpen(false);
          // Clear a failed attempt so reopening the modal starts clean
          // (the mutation lives for the screen's lifetime, not the modal's).
          cancel.reset();
        }}
        onConfirm={onConfirmCancel}
        isCanceling={cancel.isPending}
        cancelError={cancel.error ? cancelErrorMessage(cancel.error) : null}
        onPause={() =>
          pause.mutate(undefined, {
            onSuccess: () => {
              setCancelOpen(false);
              // No date claimed: `status` flips only when the provider's
              // `subscription.paused` webhook lands, so promising "paused
              // until Aug 30" here would assert something unconfirmed.
              toast('Pause requested — confirming with your payment provider.', 'success');
            },
          })
        }
        isPausing={pause.isPending}
        pauseError={pause.error ? pauseErrorMessage(pause.error) : null}
      />
    </div>
  );
}

/**
 * D118 un-cancel failures. The 409s are distinguishable and each means
 * something different, so the generic "try again" would be a lie for
 * two of the three.
 */
function resumeCancellationErrorMessage(error: unknown): string {
  // Branch on the CODE, not the status: three different 409s reach here
  // and the generic line would be wrong for two of them (`apiErrorCode`
  // doc, client.ts).
  const code = apiErrorCode(error);
  if (code === 'NO_SCHEDULED_CANCELLATION') {
    return 'This subscription is already renewing — refresh the page to see the current state.';
  }
  if (code === 'RESUME_UNSUPPORTED') {
    return 'Subscriptions billed in India can’t be restored from here. Email support@declutrmail.com and we’ll do it for you.';
  }
  if (code === 'NO_ACTIVE_SUBSCRIPTION') {
    return 'There is no subscription to restore — refresh the page to see the current state.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'Billing isn’t switched on yet.';
  }
  return 'Your subscription could not be restored. Please try again.';
}

/** D118 pause-offer failures. */
function pauseErrorMessage(error: unknown): string {
  const code = apiErrorCode(error);
  if (code === 'PAUSE_UNSUPPORTED') {
    return 'Pausing isn’t available for subscriptions billed in India. Email support@declutrmail.com and we’ll pause it for you.';
  }
  if (code === 'SUBSCRIPTION_PAUSED') {
    return 'This subscription is already paused — refresh the page to see the current state.';
  }
  if (code === 'SUBSCRIPTION_CANCELING') {
    return 'This subscription is already scheduled to cancel. Choose "Keep my subscription" first, then pause it.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'Billing isn’t switched on yet.';
  }
  return 'The pause could not be processed. Please try again.';
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
  onProviderCheck,
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
  /** D249 — server-side provider-truth check for checkout-shaped
   *  waits. When present, the manual release renders only AFTER a
   *  check has actually run and found nothing (or the provider was
   *  unreachable): the system answers its own question before ever
   *  asking the customer to. */
  onProviderCheck?: (() => Promise<BillingReconcileOutcome>) | undefined;
}) {
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  // Provider-check lifecycle for reconcilable waits. `idle` before the
  // first run; afterwards the last outcome. Checkout kinds run the
  // pending-checkout ladder; change kinds check the workspace's live
  // subscriptions (no claim row exists for a plan change). Resume waits
  // never check.
  const [providerCheck, setProviderCheck] = useState<'idle' | 'checking' | BillingReconcileOutcome>(
    'idle',
  );
  const isChangeWait = kind === 'change' || kind === 'change_unconfirmed';
  const reconcilable =
    (kind === 'checkout' || kind === 'checkout_intent' || isChangeWait) &&
    onProviderCheck !== undefined;
  // checkout_intent and change_unconfirmed surface with an UNKNOWN
  // outcome at any phase — ask the provider immediately. A confirmed
  // payment (`checkout`) waits for `unconfirmed`; a confirmed change
  // normally projects in-request, so still showing at `slow` already
  // means something dropped — ask then.
  const checkWanted =
    reconcilable &&
    (phase === 'unconfirmed' ||
      kind === 'checkout_intent' ||
      kind === 'change_unconfirmed' ||
      (kind === 'change' && phase !== 'fresh'));
  useEffect(() => {
    if (!checkWanted || providerCheck !== 'idle' || onProviderCheck === undefined) return;
    setProviderCheck('checking');
    onProviderCheck().then(setProviderCheck, () => setProviderCheck('provider_unavailable'));
  }, [checkWanted, providerCheck, onProviderCheck]);
  function recheckProvider() {
    if (onProviderCheck === undefined || providerCheck === 'checking') return;
    setProviderCheck('checking');
    onProviderCheck().then(setProviderCheck, () => setProviderCheck('provider_unavailable'));
  }
  // The release is legitimate only once the server has actually asked
  // and come back empty-handed (or genuinely could not ask, or holds
  // nothing at all for this checkout — `no_pending` with the hint sent
  // means claim AND provider search both came back empty). NEVER on
  // `payment_in_progress`: the provider holds a pre-grant artifact and
  // "no charge" would be false. Waits without a provider check keep
  // their existing release behavior.
  const releaseUnlocked =
    !reconcilable ||
    providerCheck === 'none_found' ||
    providerCheck === 'no_pending' ||
    providerCheck === 'provider_unavailable';
  // What the provider acknowledged — the factual anchor per kind.
  // `change_unconfirmed` acknowledges NOTHING: the provider's response
  // was lost, so every claim below stays outcome-neutral for it.
  const acted =
    kind === 'checkout'
      ? 'Payment received'
      : kind === 'checkout_intent'
        ? 'Checkout started'
        : kind === 'change'
          ? 'Plan change accepted'
          : kind === 'change_unconfirmed'
            ? 'Plan change unconfirmed'
            : 'Resume accepted';
  // What the wait is FOR, per kind — a first purchase is not a "plan
  // change" and the copy must not claim one (UI-truth rule).
  const awaited =
    kind === 'change' || kind === 'change_unconfirmed'
      ? 'plan change'
      : kind === 'resume'
        ? 'resume'
        : 'plan upgrade';
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
              {acted} — your {awaited} hasn&rsquo;t come through yet.
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              The provider&rsquo;s confirmation hasn&rsquo;t reached our server, so further billing
              changes stay paused — starting another could charge you twice. Waiting is always safe:
              this page keeps checking, and your plan updates the moment the confirmation arrives.
              Email{' '}
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
                : kind === 'change_unconfirmed' || kind === 'checkout_intent'
                  ? 'The outcome is unconfirmed; this page keeps checking automatically.'
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
                  : kind === 'checkout_intent'
                    ? 'A checkout was started here but its outcome wasn’t observed — if you paid, your plan updates here and nothing further is needed.'
                    : 'The payment provider is finalizing your subscription.'}{' '}
              This page updates automatically, usually within a minute.
            </span>
          </span>
        )}
      </span>
      {reconcilable && providerCheck !== 'idle' ? (
        // D249 — the server's own answer, stated before any customer
        // question. Each line asserts only what the check verified.
        <p
          data-testid="provider-check"
          style={{ margin: 0, fontSize: 12.5, color: color.fgSoft }}
          aria-live="polite"
        >
          {providerCheck === 'checking' ? (
            'Checking with the payment provider…'
          ) : providerCheck === 'none_found' ? (
            isChangeWait ? (
              // The provider answered and the awaited plan exists
              // nowhere — the change never happened. Saying "Confirmed"
              // here was the false-confirmation Codex caught.
              'We checked with the payment provider — your plan change hasn’t gone through. Your current plan is unchanged, and it’s safe to try again.'
            ) : (
              'We checked with the payment provider — no completed payment found for this checkout.'
            )
          ) : providerCheck === 'no_pending' ? (
            isChangeWait ? (
              // Change reconciles against live subscription rows; zero
              // rows mid-change is a state worth a human look.
              <>
                We found no live subscription to check against — email{' '}
                <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
                  support@declutrmail.com
                </a>
                .
              </>
            ) : (
              // Claim AND provider search both empty — nothing is in
              // flight anywhere. State that, never "found your payment".
              'Nothing is awaiting confirmation for this checkout — on our server or at the payment provider.'
            )
          ) : providerCheck === 'payment_in_progress' ? (
            'The payment provider shows this checkout still in progress — for example awaiting bank confirmation. Waiting is safe; this page keeps checking.'
          ) : providerCheck === 'provider_unavailable' ? (
            'We couldn’t reach the payment provider to check automatically.'
          ) : providerCheck === 'unresolved' ? (
            <>
              We found payment activity that needs a manual look — email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
                support@declutrmail.com
              </a>
              .
            </>
          ) : isChangeWait ? (
            // granted / already_recorded on a change wait — provider
            // truth is projected; the poll clears this via the flip.
            'Confirmed with the payment provider — your plan is updating now.'
          ) : (
            // granted / already_recorded — the projection wrote the
            // truth; the poll clears this notice via the tier flip.
            'Found your payment — your plan is updating now.'
          )}
        </p>
      ) : null}
      {reconcilable &&
      (providerCheck === 'none_found' ||
        providerCheck === 'no_pending' ||
        providerCheck === 'payment_in_progress' ||
        providerCheck === 'provider_unavailable') ? (
        // Standalone re-check for every settled, non-granted answer —
        // independent of the release, which `payment_in_progress`
        // rightly keeps locked while still needing a way to re-ask.
        <div>
          <Button tone="default" onClick={recheckProvider}>
            Check again
          </Button>
        </div>
      ) : null}
      {(phase === 'unconfirmed' ||
        kind === 'checkout_intent' ||
        // A change wait whose awaited plan is verified ABSENT at the
        // provider needs no 15-minute timer — the verification already
        // happened and waiting longer cannot change the answer.
        (isChangeWait && providerCheck === 'none_found')) &&
      onRelease &&
      releaseUnlocked ? (
        kind === 'checkout' || kind === 'checkout_intent' || kind === 'change_unconfirmed' ? (
          // A payment happened (checkout) or MAY have (unconfirmed
          // change) — release needs an explicit user assertion, never
          // one click.
          confirmingRelease ? (
            <div
              data-testid="release-confirm"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <p style={{ margin: 0, fontSize: 12.5, color: color.fg }}>
                {kind === 'checkout' || kind === 'checkout_intent' ? (
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
                  {kind === 'checkout' || kind === 'checkout_intent'
                    ? 'I checked — no charge. Resume checkout'
                    : 'I checked — nothing applied. Let me retry'}
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button tone="default" onClick={() => setConfirmingRelease(true)}>
                {kind === 'checkout' || kind === 'checkout_intent'
                  ? providerCheck === 'none_found'
                    ? 'No payment found — resume checkout'
                    : providerCheck === 'no_pending'
                      ? 'Nothing in flight — resume checkout'
                      : 'No charge went through — resume checkout'
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
  plan,
  cleanupRemaining,
  billingDark,
  onCancel,
  onResumeCancellation,
  isResumingCancellation,
  resumeCancellationError,
}: {
  plan: BillingPlanView;
  cleanupRemaining: number | null;
  billingDark: boolean;
  onCancel: () => void;
  /** D118 — revoke a scheduled cancel and go back on renewal. */
  onResumeCancellation: () => void;
  isResumingCancellation: boolean;
  resumeCancellationError: string | null;
}) {
  const manifest = TIER_MANIFEST[plan.entitlementTier];
  const { backing } = plan;
  // Two-step (matrix E3): the button arms an inline confirm that states
  // the renewal date and price before anything is sent. Same
  // preview-then-confirm shape as every other money action here — this
  // one puts a charge BACK on, so it earns the same discipline.
  const [confirmKeep, setConfirmKeep] = useState(false);

  // The card tells ONE story: the ENTITLEMENT tier. Subscription facts
  // (price, renewal, status, cancel affordance) render only from the
  // BACKING record the derive layer resolved — a paused or mismatched
  // row never leaks its price or status onto this card ("Pro · $19/mo"
  // above "your Plus subscription is paused" asserted two plans at
  // once, A6). A backing record states its own provider, so the
  // headline currency is a fact, not a guess; with NO backing record a
  // paid tier makes no price claim at all — nobody is charged one.
  const note = backingStatusNote(backing);
  const priceLabel = currentPlanPriceLabel(plan);
  // "Next renewal <date>" claims THIS plan, at THIS price, renews then.
  // With a scheduled change that is false: on Pro annual with a
  // downgrade booked, the card read "Pro · $190/yr · Next renewal Jul
  // 30, 2027" while what actually happens that day is Plus monthly at
  // $9 (founder screenshot, 2026-07-31). The scheduled-change notice
  // directly below states the real outcome, so the card stays silent
  // rather than contradict it — the same reason `cancel_scheduled`
  // already suppresses this line.
  const renewal =
    (backing.state === 'active' || backing.state === 'past_due') && plan.scheduledChange === null
      ? formatBillingDate(backing.sub.currentPeriodEnd)
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

      {plan.entitlementTier === 'free' &&
      (plan.nonBacking === null || cleanupRemaining !== null) ? (
        <p style={{ margin: 0, fontSize: 13, color: color.fgSoft }}>
          {/* "No card on file" is a claim about the PROVIDER — with a
              paused or ended subscription record the provider may well
              hold one, so the line renders only when no record exists. */}
          {plan.nonBacking === null ? 'Free forever — no card on file.' : null}
          {cleanupRemaining !== null ? (
            <>
              {' '}
              <strong style={{ fontWeight: 600, color: color.fg }}>
                {cleanupRemaining} of {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions
                left this month.
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

      {!billingDark && (backing.state === 'active' || backing.state === 'past_due') ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button tone="default" onClick={onCancel}>
            Cancel subscription
          </Button>
        </div>
      ) : null}

      {/* D118 — the way back. Without it a mis-clicked cancel was
          irreversible for up to a year: checkout answers
          SUBSCRIPTION_EXISTS and change-plan answers
          SUBSCRIPTION_CANCELING, so support had to PATCH the provider
          by hand (matrix E3, 2026-07-31).

          Only for a schedule the USER owns. A refund/chargeback row now
          reaches `cancel_scheduled` too (the projector pins the flag
          under a local verdict), and `resume-cancellation` refuses it
          with CANCELLATION_NOT_REVOCABLE — rendering the button anyway
          would offer an undo whose only possible answer is a 409. The
          status note above names the reason instead. */}
      {!billingDark &&
      backing.state === 'cancel_scheduled' &&
      backing.sub.cancelSource !== 'refund' &&
      backing.sub.cancelSource !== 'chargeback' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {confirmKeep ? (
            <div
              data-testid="keep-subscription-confirm"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px 14px',
                background: color.paper,
                border: `1px solid ${color.line}`,
                borderRadius: radius.md,
              }}
            >
              <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft, lineHeight: 1.5 }}>
                <strong style={{ fontWeight: 600, color: color.fg }}>$0 today.</strong> Your
                cancellation is called off and {manifest.name} keeps renewing
                {formatBillingDate(backing.sub.currentPeriodEnd)
                  ? ` — next charge ${formatBillingDate(backing.sub.currentPeriodEnd)}`
                  : ' on its normal schedule'}
                {currentPlanPriceLabel(plan) ? ` at ${currentPlanPriceLabel(plan)}` : ''}. You can
                cancel again at any time.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  tone="primary"
                  onClick={onResumeCancellation}
                  disabled={isResumingCancellation}
                >
                  {isResumingCancellation ? 'Restoring…' : 'Yes, keep my subscription'}
                </Button>
                <Button
                  tone="default"
                  onClick={() => setConfirmKeep(false)}
                  disabled={isResumingCancellation}
                >
                  Never mind
                </Button>
              </div>
              {resumeCancellationError != null ? (
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
                  {resumeCancellationError}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button tone="primary" onClick={() => setConfirmKeep(true)}>
                Keep my subscription
              </Button>
            </div>
          )}
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
            : 'The payment provider’s response was interrupted, so billing changes are paused until we confirm what happened.'}{' '}
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
 * A NON-BACKING subscription record's designed state (A6): a real,
 * actionable row that does NOT grant the entitlement tier. Exactly ONE
 * plan is ever named as current — the entitlement — and the record is
 * described as what it is:
 *
 *   - `paused` — the ordinary pause story: resume it (webhook restores
 *     the tier) or cancel it. Plan changes stay locked while paused
 *     (the BE rejects them with SUBSCRIPTION_PAUSED).
 *   - `canceled` — the truthful "subscription ended" line.
 *   - `tier_mismatch` — the entitlement is granted from elsewhere. The
 *     resume copy states the real consequence: the webhook recompute
 *     (billing-webhook.service) re-grants from subscription rows, which
 *     can move the workspace off its current plan. A past_due mismatch
 *     row still surfaces its dunning warning here.
 *
 * Copy states only server facts: the entitlement tier comes from the
 * derive layer's read, never assumed to be Free.
 */
function NonBackingSubscriptionNotice({
  record,
  entitlementTier,
  onResumeStarted,
  onRequestCancel,
}: {
  record: NonBackingRecord;
  /** The workspace's server-resolved entitlement tier. */
  entitlementTier: TierId;
  onResumeStarted: () => void;
  onRequestCancel: () => void;
}) {
  const resume = useResumeSubscription();
  const [confirmingResume, setConfirmingResume] = useState(false);
  const { sub, reason } = record;
  const tierName = TIER_MANIFEST[sub.tier].name;
  const entitlementName = TIER_MANIFEST[entitlementTier].name;
  const boxStyle = {
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
  } as const;

  if (reason === 'canceled') {
    return (
      <div role="status" data-testid="non-backing-subscription-notice" style={boxStyle}>
        <span>
          <strong style={{ fontWeight: 600 }}>Your {tierName} subscription ended.</strong>{' '}
          <span style={{ color: color.fgSoft }}>
            Your account is on {entitlementName}. Pick a plan below any time to subscribe again.
          </span>
        </span>
      </div>
    );
  }

  // The D253 settling window. Says why the picker is locked and that it
  // clears itself, and offers NO verb: resume is refused server-side
  // (`CANCELLATION_NOT_REVOCABLE`), and cancel is inert here because the
  // projector already pinned `cancel_at_period_end` — the service skips
  // the provider round-trip on a second cancel, so the button would
  // change nothing while implying it did.
  //
  // No date is promised. The refund clears when the provider approves it,
  // and on a live Paddle account that is a review queue we cannot see —
  // the first real refund sat pending well past the "a few minutes" the
  // error copy claims (2026-08-14). Naming a deadline we cannot keep is
  // the same assert-what-you-don't-know defect this screen exists to
  // avoid, so the copy stays vague where the truth is.
  if (reason === 'refund_settling') {
    return (
      <div role="status" data-testid="non-backing-subscription-notice" style={boxStyle}>
        <span>
          <strong style={{ fontWeight: 600 }}>Your refund is being processed.</strong>{' '}
          <span style={{ color: color.fgSoft }}>
            Your {tierName} access has ended and your account is on {entitlementName}. You can
            subscribe again once your payment provider confirms the refund. Nothing to do until then
            — we&rsquo;ll switch this back on automatically.
          </span>
        </span>
      </div>
    );
  }

  const until = formatBillingDate(sub.pauseUntil);
  const retainedPeriodEnd = formatBillingDate(sub.currentPeriodEnd);
  const isPaused = sub.status === 'paused';
  const mismatch = reason === 'tier_mismatch';
  // Self-serve resume promises "$0 today, existing period continues" —
  // only render that promise when the record IS paused and the retained
  // period is actually known (ui-truth: never assert a period the read
  // can't confirm).
  //
  // …and never over a refund/chargeback verdict. Resuming restarts
  // billing at the provider while `entitlement_ends_at` keeps the account
  // on Free, so the customer would pay and receive nothing. The API
  // refuses it (`CANCELLATION_NOT_REVOCABLE`); offering the button anyway
  // is the same guaranteed-409 defect the pause offer already avoids
  // (Codex stop-review, 2026-07-31).
  // In practice only `chargeback` reaches this line — a `refund` row
  // returns above as `refund_settling`. Both arms are kept deliberately:
  // this is a revenue path, and the cost of the redundant check is
  // nothing next to the cost of a reordering upstream silently offering
  // resume on a refunded row.
  const verdictBlocked = sub.cancelSource === 'refund' || sub.cancelSource === 'chargeback';
  const canSelfServeResume =
    isPaused && sub.provider === 'paddle' && retainedPeriodEnd !== null && !verdictBlocked;
  return (
    <div role="status" data-testid="non-backing-subscription-notice" style={boxStyle}>
      <span>
        {mismatch ? (
          <>
            <strong style={{ fontWeight: 600 }}>
              {isPaused ? `A paused ${tierName} subscription` : `A ${tierName} subscription`} is on
              your account{isPaused && until ? ` (paused until ${until})` : ''}.
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              Your account is on {entitlementName} — this subscription isn&rsquo;t what grants it.{' '}
              {isPaused
                ? `Resuming makes ${tierName} your paid subscription again; your plan is then recomputed from your subscriptions, which can move your account off ${entitlementName}. Cancel it if you’re done with it.`
                : 'Cancel it if you’re done with it.'}
            </span>
          </>
        ) : (
          <>
            <strong style={{ fontWeight: 600 }}>
              Your {tierName} subscription is paused{until ? ` until ${until}` : ''}.
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              While it&rsquo;s paused you aren&rsquo;t billed, and your account is on{' '}
              {entitlementName}. Resume to reactivate {tierName}, or cancel if you&rsquo;re done
              with it.
            </span>
          </>
        )}
      </span>
      {mismatch && sub.status === 'past_due' ? (
        <p style={{ margin: 0, fontSize: 12.5, color: color.amber }}>
          Payment past due — update your payment method with the provider to keep it.
        </p>
      ) : null}
      {isPaused && !canSelfServeResume ? (
        <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft }}>
          {sub.provider === 'razorpay'
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
            {mismatch
              ? ` Resuming re-grants ${tierName} from this subscription; your account’s plan is then recomputed from your subscriptions and can change from ${entitlementName}.`
              : null}
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

/**
 * Founding Pro banner (D119 / D126). Price straight off the manifest,
 * in the currency the member's own rail locked — a Razorpay founding
 * member's price is locked at ₹10,999/yr, not $129/yr.
 */
function FoundingBanner({ provider }: { provider: BillingProviderId }) {
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
        {formatMoney(promo.annual, currencyForProvider(provider))}/yr while your subscription stays
        active.
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
      nothing about your account changes until you choose one.
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

function BillingErrorState({ onRetry }: { onRetry: () => void }) {
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
        description="No charge or plan change was made. Try again in a moment."
        onRetry={onRetry}
      />
    </div>
  );
}

/**
 * The UNKNOWN designed state (A6): the billing read answered 200 with
 * a payload outside the contract schema. Unknown stays unknown — the
 * screen shows nothing rather than something wrong (no invented tier,
 * price, or status).
 */
function BillingUnknownState({ onRetry }: { onRetry: () => void }) {
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
        title="We couldn't read your billing details"
        description="The billing service answered in a format this page doesn't recognize, so nothing is shown rather than something wrong. Loading this page made no charge or plan change. Try again in a moment."
        onRetry={onRetry}
      />
    </div>
  );
}
