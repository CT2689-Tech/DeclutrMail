'use client';

import { useEffect, useState } from 'react';
import { BannerSlot } from '@declutrmail/shared';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { useTier } from '@/features/auth/api/use-tier';
import { useBillingSubscription } from '@/features/billing/api/use-billing-subscription';
import { usePaymentMethodSession } from '@/features/billing/api/use-payment-method';

import { accessDeadlineCopy, accessDeadlineDismissKey } from './access-deadline-copy';

function readDismissed(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(key: string): void {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // A blocked session store still hides the banner until the next view.
  }
}

/** App-chrome billing banner. One slot, session-dismissed, server date only. */
export function AccessDeadlineBanner() {
  const { tier } = useTier();
  const billing = useBillingSubscription();
  const paymentMethod = usePaymentMethodSession();
  const banner = accessDeadlineCopy(tier, billing.data?.subscription ?? null);
  const dismissKey = banner === null ? null : accessDeadlineDismissKey(banner);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(dismissKey !== null && readDismissed(dismissKey));
  }, [dismissKey]);

  const ready = banner !== null && !dismissed;
  return (
    <BannerSlot
      candidates={[
        {
          id: 'past_due',
          ready,
          node: ready ? (
            <div role="status" data-testid="access-deadline-banner">
              <p>{banner.message}</p>
              {banner.showCardUpdate ? (
                <button
                  type="button"
                  onClick={() => paymentMethod.mutate()}
                  disabled={paymentMethod.isPending}
                >
                  {WS2_COPY.banners.pastDue.cta}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (dismissKey !== null) rememberDismissed(dismissKey);
                  setDismissed(true);
                }}
              >
                {WS2_COPY.banners.pastDue.dismiss}
              </button>
            </div>
          ) : null,
        },
      ]}
    />
  );
}
