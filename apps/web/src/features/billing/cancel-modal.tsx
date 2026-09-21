'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Button, PreviewSheet, tokens } from '@declutrmail/shared';
import type { CancelRequest } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { formatBillingDate, type SubscriptionRecord } from './billing-model';

const { color, font, radius, space, text } = tokens;

type CancelReason = NonNullable<CancelRequest['reason']>;

/** D118 reason enum, labeled. Optional — never a wall before the exit. */
const REASON_OPTIONS: ReadonlyArray<{ value: CancelReason; label: string }> = [
  { value: 'not_using_enough', label: 'Not using it enough' },
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'found_another_tool', label: 'Found another tool' },
  { value: 'privacy_concerns', label: 'Privacy concerns' },
  { value: 'other', label: 'Other' },
];

/**
 * Cancel-subscription confirm (D118/D120).
 *
 * Preview-then-confirm: the modal states exactly what happens —
 * features stay until period end, then Free; canceling isn't itself a
 * refund (D120 downgrade copy) — before the mutation runs. Not the D226
 * destructive-preview class (no mail is touched), but the same honest
 * shape. EVERY paid plan carries the D121 30-day money-back guarantee
 * (founder-confirmed 2026-07-08 — all paid tiers, not Pro-only); it is
 * The guarantee is NOT mentioned here (founder, 2026-07-31). Naming a
 * refund at the moment of highest churn intent reads as an invitation —
 * "if I see this as a term, I will go ahead and ask for a refund every
 * time". The policy stays public on /refunds and on the Plan & billing
 * header, so nothing is hidden; this screen simply stops advertising it.
 * The bullet below still says canceling is not itself a refund, which is
 * a fact about cancellation, not a denial of the guarantee — so the
 * 2026-07-08 contradiction with the public 30-day promise does not
 * return.
 */
export function CancelModal({
  open,
  sub,
  backsEntitlement,
  entitlementTier,
  onClose,
  onConfirm,
  isCanceling,
  cancelError,
  onPause,
  isPausing,
  pauseError,
}: {
  open: boolean;
  /** The record this cancel targets — backing or non-backing (A6). */
  sub: SubscriptionRecord | null;
  /** True when `sub` is what GRANTS the entitlement tier — only then
   *  may the preview claim "then your account switches to Free". A
   *  non-backing record (paused / other tier) doesn't grant the current
   *  plan, and its features are not necessarily active. */
  backsEntitlement: boolean;
  entitlementTier: TierId;
  onClose: () => void;
  onConfirm: (reason: CancelReason | undefined) => void;
  isCanceling: boolean;
  cancelError: string | null;
  /** D118 — "Pause for 30 days" instead of cancelling. */
  onPause: () => void;
  isPausing: boolean;
  pauseError: string | null;
  /** Accepted for callers; the sheet is a bottom sheet on phones by
   *  itself now (`PreviewSheet` is CSS-responsive). */
  variant?: 'modal' | 'sheet';
}) {
  const [reason, setReason] = useState<CancelReason | ''>('');

  // A fresh open never inherits the last attempt's reason.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!open || !sub) return null;

  const tierLabel = TIER_MANIFEST[sub.tier].name;
  const entitlementName = TIER_MANIFEST[entitlementTier].name;
  const end = formatBillingDate(sub.currentPeriodEnd);
  // Mirrors `BillingService.pauseForThirtyDays`'s guards exactly, so the
  // offer never renders on a subscription the API would refuse.
  const canPause = sub.provider === 'paddle' && sub.status === 'active' && !sub.cancelAtPeriodEnd;

  // Each fact its own element — they are read (and pinned) one by one.
  const periodEnd = backsEntitlement ? (
    <>
      <span>
        {end
          ? `Your ${tierLabel} features stay active until ${end}.`
          : `Your ${tierLabel} features stay active until the end of the current billing period.`}
      </span>{' '}
      <span>Then your account switches to Free — completed email actions stay in place.</span>
    </>
  ) : (
    // A NON-BACKING record (A6): its features are not necessarily active
    // and it does not grant the current plan — the preview claims neither.
    <>
      <span>
        {end
          ? `Your ${tierLabel} subscription ends at the end of its paid period (${end}) and won't renew.`
          : `Your ${tierLabel} subscription ends at the end of its paid period and won't renew.`}
      </span>{' '}
      <span>
        Your account is on {entitlementName} today — that plan isn&rsquo;t granted by this
        subscription.
      </span>
    </>
  );

  return (
    <PreviewSheet
      testId="cancel-modal"
      onClose={onClose}
      title={
        backsEntitlement ? `Cancel your ${tierLabel} plan?` : `End your ${tierLabel} subscription?`
      }
      subtitle={periodEnd}
      note={
        <>
          <span>
            Canceling stops your renewal and takes effect at period end — on its own it isn&rsquo;t
            a refund.
          </span>
          {sub.foundingMember ? (
            // QA-billing-20260901-09: the founding price lock is otherwise
            // discoverable only after re-subscribing fails with
            // FOUNDING_PRO_SOLD_OUT once the 250 slots are gone — name the
            // cost before the click that can make it permanent.
            <>
              {' '}
              <span>
                You&rsquo;re a Founding Pro member — this locked price doesn&rsquo;t come back once
                canceled and the 250 slots fill up.
              </span>
            </>
          ) : null}
        </>
      }
      primary={{
        label: 'Cancel subscription',
        tone: 'danger',
        onClick: () => onConfirm(reason === '' ? undefined : reason),
        busyLabel: isCanceling ? 'Canceling…' : undefined,
      }}
      // Codex round 1 (QA-billing-20260901-06): "Keep current plan" is
      // wrong for a non-backing row — the subscription under review is NOT
      // the current plan, so a dismiss reading "keep [this]" would claim
      // the opposite of backsEntitlement. A danger sheet lands focus here,
      // never on Pause (a real mutation) — QA-billing-20260901-11.
      cancelLabel={backsEntitlement ? 'Keep current plan' : 'Never mind'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[4], textAlign: 'left' }}>
        {/* D118's retention offer. Offered only where it can actually
            work: Paddle (Razorpay has no pause primitive we drive —
            `PAUSE_UNSUPPORTED`), on an active row that is not already on
            its way out. A button that answers 409 would be the same
            asserting-what-we-don't-know defect this codebase keeps
            paying for. */}
        {canPause ? (
          <div
            data-testid="pause-offer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: space[3],
            }}
          >
            <p
              style={{
                margin: 0,
                flex: '1 1 200px',
                fontSize: text.sm,
                color: color.fgSoft,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ fontWeight: 600, color: color.fg }}>Pause instead?</strong> Billing
              stops for 30 days and picks up automatically after that. Your senders, rules and
              history stay exactly as they are.
            </p>
            <Button tone="default" size="sm" onClick={onPause} disabled={isPausing || isCanceling}>
              {isPausing ? 'Pausing…' : 'Pause for 30 days'}
            </Button>
            {pauseError != null ? <ErrorLine>{pauseError}</ErrorLine> : null}
          </div>
        ) : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: text.sm }}>
          <span style={{ color: color.fgMuted }}>Why are you canceling? (optional)</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as CancelReason | '')}
            style={{
              height: 40,
              borderRadius: radius.md,
              border: 'none',
              background: color.fill,
              color: color.fg,
              fontFamily: font.sans,
              fontSize: text.md,
              padding: '0 12px',
            }}
          >
            <option value="">Prefer not to say</option>
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {cancelError != null && <ErrorLine>{cancelError}</ErrorLine>}
      </div>
    </PreviewSheet>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        flexBasis: '100%',
        fontSize: text.sm,
        color: color.danger,
        background: color.dangerBg,
        borderRadius: radius.md,
        padding: '10px 12px',
      }}
    >
      {children}
    </div>
  );
}
