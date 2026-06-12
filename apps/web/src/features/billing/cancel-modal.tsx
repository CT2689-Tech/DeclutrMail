'use client';

import { useEffect, useState } from 'react';

import { Button, Eyebrow, tokens, useFocusTrap } from '@declutrmail/shared';
import type { BillingSubscription, CancelRequest } from '@declutrmail/shared/contracts';

import { formatBillingDate, MONEY_BACK_NOTE } from './billing-model';

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
 * features stay until period end, then Free; no refund for unused time
 * (D120 downgrade copy) — before the mutation runs. Not the D226
 * destructive-preview class (no mail is touched), but the same honest
 * shape. Pro subscriptions also carry the D121 money-back route, which
 * is a refund-and-cancel-now alternative handled by support.
 */
export function CancelModal({
  open,
  subscription,
  onClose,
  onConfirm,
  isCanceling,
  cancelError,
}: {
  open: boolean;
  subscription: NonNullable<BillingSubscription['subscription']> | null;
  onClose: () => void;
  onConfirm: (reason: CancelReason | undefined) => void;
  isCanceling: boolean;
  cancelError: string | null;
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

  if (!open || !subscription) return null;

  const tierLabel = subscription.tier === 'pro' ? 'Pro' : 'Plus';
  const end = formatBillingDate(subscription.currentPeriodEnd);

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
            Cancel your {tierLabel} plan?
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
            <li>
              {end
                ? `Your ${tierLabel} features stay active until ${end}.`
                : `Your ${tierLabel} features stay active until the end of the current billing period.`}
            </li>
            <li>Then your workspace switches to Free — nothing you&rsquo;ve cleaned is undone.</li>
            <li>No refund for unused time (cancellation takes effect at period end).</li>
          </ul>

          {subscription.tier === 'pro' ? (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: color.fgMuted,
                lineHeight: 1.5,
                background: color.paper,
                border: `1px solid ${color.line}`,
                borderRadius: radius.md,
                padding: '8px 10px',
              }}
            >
              Pro has a {MONEY_BACK_NOTE} — if you subscribed within the last 30 days and want a
              full refund instead, reply to your receipt email and we&rsquo;ll process it.
            </p>
          ) : null}

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
