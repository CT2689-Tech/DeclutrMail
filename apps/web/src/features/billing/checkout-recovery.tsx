'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@declutrmail/shared';
import type { BillingCycle, CheckoutSession } from '@declutrmail/shared/contracts';
import { CheckoutLaunchError, launchCheckout } from './checkout';
import { readPendingCheckout, withMoneyActionMutex } from './pending-checkout';

export interface HeldCheckout {
  workspaceId: string;
  session: CheckoutSession;
  target: 'plus' | 'pro';
  cycle: BillingCycle;
  attemptId: string;
  expiresAt: number;
}

/** Session stays in memory; the persistent reservation continues to block new purchases. */
export function CheckoutRecovery({
  held,
  mayOpen,
  onOpened,
  onCompleted,
  onClosed,
}: {
  held: HeldCheckout;
  mayOpen: () => boolean;
  onOpened: () => void;
  onCompleted: () => void;
  /** `overlay_closed` only when the customer closed the overlay opened
   *  here; the expiry and launch-failure exits carry no cause. */
  onClosed: (cause?: 'overlay_closed') => void;
}) {
  const busy = useRef(false);
  const mounted = useRef(true);
  const [opening, setOpening] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    mounted.current = true;
    if (Date.now() >= held.expiresAt) setExpired(true);
    const timer = setTimeout(() => setExpired(true), Math.max(0, held.expiresAt - Date.now()));
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [held.expiresAt]);
  async function retry() {
    if (busy.current || expired) return;
    busy.current = true;
    setOpening(true);
    try {
      await withMoneyActionMutex(held.workspaceId, async () => {
        const pending = readPendingCheckout(held.workspaceId);
        if (
          Date.now() >= held.expiresAt ||
          pending?.kind !== 'checkout_intent' ||
          pending.attemptId !== held.attemptId ||
          pending.toTier !== held.target ||
          pending.toCycle !== held.cycle
        ) {
          onClosed();
          return;
        }
        await launchCheckout(
          held.session,
          { onCompleted, onClosed: () => onClosed('overlay_closed') },
          () => {
            const current = readPendingCheckout(held.workspaceId);
            return (
              mounted.current &&
              mayOpen() &&
              Date.now() < held.expiresAt &&
              current?.kind === 'checkout_intent' &&
              current.attemptId === held.attemptId
            );
          },
        );
        onOpened();
      });
    } catch (err) {
      if (err instanceof CheckoutLaunchError && err.canRetry) setError(true);
      else onClosed();
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }
  return (
    <div role="status">
      <p>The secure checkout window could not open. This checkout is still reserved.</p>
      {expired ? (
        <p>
          This window has expired. Check the payment status below before starting another checkout.
        </p>
      ) : (
        <Button tone="default" disabled={opening} onClick={() => void retry()}>
          {opening ? 'Opening checkout…' : 'Retry checkout window'}
        </Button>
      )}
      {error && (
        <p role="alert">The window still could not load. Check your connection and try again.</p>
      )}
    </div>
  );
}
