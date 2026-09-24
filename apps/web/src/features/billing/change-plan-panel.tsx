'use client';

import { useEffect, useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type {
  BillingCycle,
  BillingProviderId,
  PurchasableTier as PaidTier,
} from '@declutrmail/shared/contracts';
import { GroupTitle } from '@/features/settings/settings-list';
import { PlanConsequences } from './plan-coverage';
import { usePlanChangePreview } from './api/use-plan-change-preview';
import {
  formatBillingDate,
  formatProviderAmount,
  isDeferredDowngrade,
  MONEY_BACK_NOTE,
  quotedPlanPrice,
} from './billing-model';

const { color, radius, text } = tokens;

/**
 * The D226 confirm step for a PLAN CHANGE on the existing subscription
 * (D117/D120): states the from→to switch, the new price, and the
 * provider-prorated billing consequence, then ONE confirm into
 * `POST /api/billing/change-plan`. No provider pick and no overlay —
 * the change rides the subscription's existing payment method.
 */
export function ChangePlanPanel({
  target,
  cycle,
  fromTier,
  fromCycle,
  currentPeriodEnd,
  provider,
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
  /** The GRANTING subscription's own rail — what this account is
   *  already being charged on, so it is a fact, not a regional guess. */
  provider: BillingProviderId;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const toLabel = quotedPlanPrice(target, cycle, provider);
  const samePlan = target === fromTier && cycle === fromCycle;
  const isDowngrade = isDeferredDowngrade(fromTier, fromCycle, target, cycle);
  const effectiveDate = formatBillingDate(currentPeriodEnd);
  // Upgrades charge NOW — ask the provider for the exact prorated
  // number while the panel is open. Immediate confirmation requires a fresh quote.
  const preview = usePlanChangePreview({
    tierId: target,
    cycle,
    enabled: !samePlan && !isDowngrade,
  });
  const previewData = preview.data;
  const quoteResult = previewData?.kind === 'immediate' ? previewData.result : null;
  const quotedCharge = quoteResult
    ? formatProviderAmount(quoteResult.amount, quoteResult.currencyCode)
    : null;
  const [expiredQuote, setExpiredQuote] = useState(0);
  useEffect(() => {
    const updatedAt = preview.dataUpdatedAt;
    if (!updatedAt) return;
    const timer = window.setTimeout(
      () => setExpiredQuote(updatedAt),
      Math.max(0, 30_000 - (Date.now() - updatedAt)),
    );
    return () => window.clearTimeout(timer);
  }, [preview.dataUpdatedAt]);
  const quoteReady =
    !preview.isFetching &&
    !preview.isError &&
    preview.isSuccess &&
    quotedCharge !== null &&
    preview.dataUpdatedAt > expiredQuote &&
    Date.now() - preview.dataUpdatedAt < 30_000;
  const nextBilledDate =
    previewData?.kind === 'immediate' && previewData.nextBilledAt
      ? formatBillingDate(previewData.nextBilledAt)
      : null;
  return (
    <div
      data-testid="change-plan-panel"
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
      <GroupTitle as="div">Preview · before anything changes</GroupTitle>
      {samePlan ? (
        <p style={{ margin: 0, fontSize: text.md, color: color.fgSoft }}>
          This is your current plan and billing cycle — nothing to change.
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: text.md, color: color.fg }}>
            <strong style={{ fontWeight: 600 }}>
              {TIER_MANIFEST[fromTier].name} ({fromCycle}) → {TIER_MANIFEST[target].name} ({cycle})
            </strong>
            {toLabel ? (
              <span style={{ color: color.fgSoft }}>
                {' '}
                — plan price {toLabel}{' '}
                {isDowngrade
                  ? effectiveDate
                    ? `from ${effectiveDate}.`
                    : 'from your next renewal.'
                  : 'from now on.'}
              </span>
            ) : null}
          </p>
          {isDowngrade ? (
            <p style={{ margin: 0, fontSize: text.sm, color: color.fgSoft }}>
              <strong style={{ fontWeight: 600, color: color.fg }}>$0 today.</strong> Your current
              plan stays active
              {effectiveDate ? ` through ${effectiveDate}` : ' through this billing period'}, then{' '}
              {TIER_MANIFEST[target].name} ({cycle}) begins. There is no refund or credit for the
              period you already paid for.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: text.sm, color: color.fgSoft }}>
              {/* QA-billing-20260901-10, Codex round 2: this whole panel is
                  labeled "Preview · before anything changes" — nothing has
                  been charged or credited yet, Confirm hasn't been clicked.
                  A present-tense "Charged today." here asserted a completed
                  action inside a screen that promises it hasn't acted; the
                  same defect the confirmed and unconfirmed branches share,
                  named the same way, so all three read as previews of an
                  outcome, not the outcome. Also: a credit lands in the
                  account balance, never "on the payment method" — the
                  fallback previously claimed the latter for both
                  directions, contradicting the confirmed credit branch. */}
              {quotedCharge && quoteResult?.action === 'charge' ? (
                <>
                  <strong style={{ fontWeight: 600, color: color.fg }}>If you confirm:</strong>{' '}
                  {quotedCharge} is charged today — the prorated difference for the rest of this
                  period. {TIER_MANIFEST[target].name} starts as soon as your payment provider
                  confirms, usually within a minute.
                </>
              ) : quotedCharge && quoteResult?.action === 'credit' ? (
                <>
                  <strong style={{ fontWeight: 600, color: color.fg }}>If you confirm:</strong> no
                  new charge today. The unused value of your current plan covers it, and{' '}
                  {quotedCharge} is credited to your balance. {TIER_MANIFEST[target].name} starts as
                  soon as your payment provider confirms, usually within a minute.
                </>
              ) : (
                <span role="status">
                  {preview.isFetching
                    ? 'Checking the charge or credit with your payment provider…'
                    : 'We could not confirm the amount. Refresh the quote before continuing.'}
                </span>
              )}
              {nextBilledDate && toLabel ? (
                <>
                  {' '}
                  Next billing date: {nextBilledDate}. Plan price: {toLabel}; the final invoice may
                  include tax or adjustments.
                </>
              ) : null}
            </p>
          )}
          {/* Purchase reassurance, so it belongs on the branch where money
              moves TODAY. On a downgrade the line directly above already
              says "$0 today … no refund or credit for the period you
              already paid for" — appending the guarantee there reads as a
              contradiction of the sentence before it (founder,
              2026-07-30). The guarantee still governs the ORIGINAL charge;
              /refunds is where its terms live. */}
          {isDowngrade ? null : (
            <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>
          )}
        </>
      )}

      {!isDowngrade && quoteResult && !quoteReady ? (
        <p role="status" style={{ color: color.fgMuted }}>
          {preview.isFetching
            ? 'Refreshing your quote…'
            : 'This quote needs refreshing before you can confirm.'}
        </p>
      ) : null}
      <PlanConsequences fromTier={fromTier} toTier={target} />
      {!isDowngrade && !samePlan && !quoteReady && !preview.isFetching ? (
        <Button onClick={() => void preview.refetch()} disabled={isPending}>
          Refresh quote
        </Button>
      ) : null}
      {errorMessage != null && (
        <div
          role="alert"
          style={{
            fontSize: text.sm,
            color: color.danger,
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
          onClick={() => {
            if (!isDowngrade && (!quoteReady || Date.now() - preview.dataUpdatedAt >= 30_000)) {
              void preview.refetch();
              return;
            }
            onConfirm();
          }}
          disabled={isPending || samePlan || (!isDowngrade && !quoteReady)}
        >
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
