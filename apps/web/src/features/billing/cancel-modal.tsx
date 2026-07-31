'use client';

import { useEffect, useState } from 'react';

import { Button, Eyebrow, tokens, useFocusTrap } from '@declutrmail/shared';
import type { CancelRequest } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';

import { formatBillingDate, MONEY_BACK_NOTE, type SubscriptionRecord } from './billing-model';

const { color, font, radius } = tokens;

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
 * NAMED here so canceling is never mistaken for a refund, and pointed at
 * /refunds rather than advertised (see the note on the copy below).
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
}) {
  const [reason, setReason] = useState<CancelReason | ''>('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open || !sub) return null;

  const tierLabel = TIER_MANIFEST[sub.tier].name;
  const entitlementName = TIER_MANIFEST[entitlementTier].name;
  const end = formatBillingDate(sub.currentPeriodEnd);
  // Mirrors `BillingService.pauseForThirtyDays`'s guards exactly, so the
  // offer never renders on a subscription the API would refuse.
  const canPause = sub.provider === 'paddle' && sub.status === 'active' && !sub.cancelAtPeriodEnd;

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
        aria-labelledby="dm-cancel-title"
        data-testid="cancel-modal"
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(480px, calc(100vw - 32px))',
          maxHeight: '76vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow>Preview · before anything changes</Eyebrow>
          <h2
            id="dm-cancel-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {backsEntitlement
              ? `Cancel your ${tierLabel} plan?`
              : `End your ${tierLabel} subscription?`}
          </h2>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 13,
              color: color.fgSoft,
              lineHeight: 1.5,
            }}
          >
            {backsEntitlement ? (
              <>
                <li>
                  {end
                    ? `Your ${tierLabel} features stay active until ${end}.`
                    : `Your ${tierLabel} features stay active until the end of the current billing period.`}
                </li>
                <li>Then your account switches to Free — completed mail actions stay in place.</li>
              </>
            ) : (
              // A NON-BACKING record (A6): its features are not
              // necessarily active and it does not grant the current
              // plan — the preview claims neither.
              <>
                <li>
                  {end
                    ? `Your ${tierLabel} subscription ends at the end of its paid period (${end}) and won't renew.`
                    : `Your ${tierLabel} subscription ends at the end of its paid period and won't renew.`}
                </li>
                <li>
                  Your account is on {entitlementName} today — that plan isn&rsquo;t granted by this
                  subscription.
                </li>
              </>
            )}
            <li>
              Canceling stops your renewal and takes effect at period end — on its own it
              isn&rsquo;t a refund.
            </li>
          </ul>

          {/* D118's retention offer, finally built. It was specced in
              the D-body ("Would you like to pause instead?") and shipped
              as nothing: no endpoint, no button — while the paused STATE
              was fully modeled. So the one lever meant to catch a
              cancellation never ran (matrix E3 follow-up, 2026-07-31).

              Offered only where it can actually work: Paddle (Razorpay
              has no pause primitive we drive — `PAUSE_UNSUPPORTED`), on
              an active row that is not already on its way out. Offering
              a button that answers 409 would be the same
              asserting-what-we-don't-know defect this codebase keeps
              paying for. */}
          {canPause ? (
            <div
              data-testid="pause-offer"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '10px 12px',
                background: color.paper,
                border: `1px solid ${color.line}`,
                borderRadius: radius.md,
              }}
            >
              <p style={{ margin: 0, fontSize: 12.5, color: color.fgSoft, lineHeight: 1.5 }}>
                <strong style={{ fontWeight: 600, color: color.fg }}>Pause instead?</strong> Billing
                stops for 30 days and picks up automatically after that. Your senders, rules and
                history stay exactly as they are.
              </p>
              <div>
                <Button tone="default" onClick={onPause} disabled={isPausing || isCanceling}>
                  {isPausing ? 'Pausing…' : 'Pause for 30 days'}
                </Button>
              </div>
              {pauseError != null ? (
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
                  {pauseError}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Stated, not merchandised. Every paid plan carries the D121
              30-day money-back guarantee and the policy is public, so
              staying silent about it here would be a trust asymmetry —
              and would push people toward chargebacks, which cost more
              than refunds. But the previous revision put it in a filled
              panel with a primary-weight "Request a refund →" CTA, at the
              single highest-intent-to-churn moment in the product, shown
              to everyone regardless of eligibility (founder,
              2026-07-30). It also flatly promised "you can get a full
              refund", which /refunds qualifies — once per customer, plus
              fair-use terms and exclusions. Plain sentence, real link,
              accurate hedge; the policy page carries the terms and the
              request address. */}
          <p style={{ margin: 0, fontSize: 12.5, color: color.fgMuted, lineHeight: 1.5 }}>
            Charged in the last 30 days? The {MONEY_BACK_NOTE} may apply — the{' '}
            <a href="/refunds#refund-window" style={{ color: color.fgSoft }}>
              Refund Policy
            </a>{' '}
            has the terms and how to ask.
          </p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
            <span style={{ color: color.fgMuted }}>Why are you canceling? (optional)</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as CancelReason | '')}
              style={{
                height: 32,
                borderRadius: radius.md,
                border: `1px solid ${color.border}`,
                background: color.paper,
                color: color.fg,
                fontFamily: font.sans,
                fontSize: 13,
                padding: '0 8px',
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

          {cancelError != null && (
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
              {cancelError}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <Button tone="default" onClick={onClose} disabled={isCanceling}>
            Keep my plan
          </Button>
          <Button
            tone="danger"
            onClick={() => onConfirm(reason === '' ? undefined : reason)}
            disabled={isCanceling}
          >
            {isCanceling ? 'Canceling…' : 'Cancel subscription'}
          </Button>
        </div>
      </div>
    </>
  );
}
