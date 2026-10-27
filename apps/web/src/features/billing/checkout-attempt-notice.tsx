'use client';
import { Button } from '@declutrmail/shared';
import type { CheckoutAttempt } from '@declutrmail/shared/contracts';
import { useCheckoutAttemptRecovery } from './use-checkout-attempt-recovery';

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
    attempt.offer === 'pass_onetime'
      ? 'Backlog Pass'
      : `${attempt.tier === 'pro' ? 'Pro' : 'Plus'} subscription`;
  const message =
    attempt.state === 'open'
      ? `${name} checkout is ready. Resume it to continue this purchase.`
      : attempt.state === 'stopping'
        ? `Canceling your ${name} checkout. You keep your current access.`
        : attempt.state === 'paid'
          ? `Your ${name} payment is confirmed. We’re activating your purchase.`
          : attempt.state === 'payment_in_progress'
            ? `Your ${name} payment is still processing. You keep your current access.`
            : `We’re checking your ${name} checkout. You keep your current access.`;
  return (
    <div role="status" data-testid="checkout-attempt-notice">
      <p>{message}</p>
      {autoStopped ? (
        <p>Automatic checking has stopped. Check payment status or contact billing support.</p>
      ) : (
        <p>Payment status is checked automatically while this page is open.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {attempt.canResume && (
          <Button tone="primary" disabled={busy} onClick={() => void act('resume')}>
            Resume checkout
          </Button>
        )}
        <Button tone="default" disabled={busy} onClick={() => void act('check')}>
          Check payment status
        </Button>
        {attempt.canCancel && (
          <Button tone="default" disabled={busy} onClick={() => void act('cancel')}>
            {attempt.state === 'stopping' ? 'Retry cancellation' : 'Cancel checkout'}
          </Button>
        )}
        <a href="mailto:support@declutrmail.com">Contact billing support</a>
      </div>
    </div>
  );
}
