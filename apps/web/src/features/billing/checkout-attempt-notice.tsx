'use client';
import { Button, tokens } from '@declutrmail/shared';
import type { CheckoutAttempt } from '@declutrmail/shared/contracts';
import linkStyles from './billing-links.module.css';
import { useCheckoutAttemptRecovery } from './use-checkout-attempt-recovery';

const { color, radius, text } = tokens;

/** Purchase status belongs to the server attempt, independent of current access. */
export function CheckoutAttemptNotice({
  attempt,
  onUpdated,
  ownerId,
}: {
  attempt: CheckoutAttempt;
  onUpdated: () => void;
  ownerId: string;
}) {
  const { busy, error, autoStopped, act } = useCheckoutAttemptRecovery(attempt, ownerId, onUpdated);
  const name =
    attempt.offer === 'pass_onetime' ? 'Backlog Pass' : attempt.tier === 'pro' ? 'Pro' : 'Plus';
  const [heading, detail] =
    attempt.state === 'open'
      ? [`Your ${name} checkout is still open.`, 'Resume it to finish this purchase.']
      : attempt.state === 'stopping'
        ? [`Canceling your ${name} checkout.`, 'You keep your current access.']
        : attempt.state === 'paid'
          ? [`Your ${name} payment is confirmed.`, 'We’re activating your purchase.']
          : attempt.state === 'payment_in_progress'
            ? [`Your ${name} payment is still processing.`, 'You keep your current access.']
            : [`We’re checking your ${name} checkout.`, 'You keep your current access.'];
  return (
    <div
      role="status"
      data-testid="checkout-attempt-notice"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 16px',
        background: color.primarySoft,
        borderRadius: radius.lg,
        fontSize: text.md,
        lineHeight: 1.55,
        color: color.fg,
      }}
    >
      <h2 style={{ margin: 0, fontSize: text.md, fontWeight: 600 }}>{heading}</h2>
      <p style={{ margin: 0, color: color.fgSoft }}>
        {detail}{' '}
        {autoStopped
          ? 'Automatic checking has stopped — check payment status or contact billing support.'
          : 'Payment status is checked automatically while this page is open.'}
      </p>
      {error && (
        <p role="alert" style={{ margin: 0, color: color.dangerText }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {attempt.canResume && (
          <Button tone="primary" disabled={busy} onClick={() => void act('resume')}>
            Resume checkout
          </Button>
        )}
        {attempt.canCancel && (
          <Button tone="default" disabled={busy} onClick={() => void act('cancel')}>
            {attempt.state === 'stopping' ? 'Retry cancellation' : 'Cancel checkout'}
          </Button>
        )}
        <Button tone="ghost" disabled={busy} onClick={() => void act('check')}>
          Check payment status
        </Button>
      </div>
      <p style={{ margin: 0, fontSize: text.sm }}>
        Need help?{' '}
        <a className={linkStyles.link} href="mailto:support@declutrmail.com">
          Contact billing support
        </a>
        .
      </p>
    </div>
  );
}
