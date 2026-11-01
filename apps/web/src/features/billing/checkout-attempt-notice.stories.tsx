import { useEffect, useState } from 'react';
import { CheckoutAttemptNotice } from './checkout-attempt-notice';
import type { CheckoutAttempt } from '@declutrmail/shared/contracts';
import { tokens } from '@declutrmail/shared';

const initial: CheckoutAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  state: 'open',
  tier: 'plus',
  cycle: 'annual',
  offer: 'pass_onetime',
  createdAt: '2026-10-25T12:00:00.000Z',
  canResume: true,
  canCancel: true,
};
function RecoveryFixture({ state = 'open' }: { state?: CheckoutAttempt['state'] }) {
  const [attempt, setAttempt] = useState<CheckoutAttempt>({
    ...initial,
    state,
    canResume: state === 'open',
    canCancel: state === 'open',
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = globalThis.fetch;
    let current = { ...initial, state, canResume: state === 'open', canCancel: state === 'open' };
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/billing/reconcile'))
        return new Response(
          JSON.stringify({
            data: { outcome: 'payment_in_progress', exact: false, attempt: current },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      if (url.includes(`/api/billing/checkout/${initial.id}/cancel`)) {
        current = {
          ...current,
          state: 'stopped',
          version: current.version + 1,
          canResume: false,
          canCancel: false,
        };
        setAttempt(current);
        return new Response(JSON.stringify({ data: current }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    };
    setReady(true);
    return () => {
      globalThis.fetch = original;
    };
  }, [state]);
  return (
    <div
      style={{
        background: tokens.color.bg,
        color: tokens.color.fg,
        fontFamily: tokens.font.sans,
        padding: 24,
        maxWidth: 900,
      }}
    >
      <p>Synthetic checkout recovery preview</p>
      <h1 style={{ fontSize: 28 }}>Plan & billing</h1>
      {ready && attempt.state !== 'stopped' && (
        <CheckoutAttemptNotice attempt={attempt} ownerId="synthetic" onUpdated={() => {}} />
      )}
      {attempt.state === 'stopped' && <p role="status">Checkout canceled.</p>}
      <h2>Current plan</h2>
      <p>Pro · Complimentary</p>
      <p>Pro is complimentary on this account. Your existing access continues.</p>
    </div>
  );
}
export default {
  title: 'Features/Billing/CheckoutAttempt',
  component: CheckoutAttemptNotice,
  parameters: { layout: 'fullscreen' },
};
export const PassWithComplimentaryPro = { render: () => <RecoveryFixture /> };
export const PaidPassAwaitingAccess = { render: () => <RecoveryFixture state="paid" /> };
export const PaymentInProgress = { render: () => <RecoveryFixture state="payment_in_progress" /> };
export const UnknownPayment = { render: () => <RecoveryFixture state="unknown" /> };
export const Stopping = { render: () => <RecoveryFixture state="stopping" /> };
