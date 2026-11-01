'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { BannerSlot } from '@declutrmail/shared';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { useTier } from '@/features/auth/api/use-tier';
import { useBillingSubscription } from '@/features/billing/api/use-billing-subscription';
import { billingKeys } from '@/features/billing/api/query-keys';
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

/**
 * App-chrome billing banner. One slot, session-dismissed, server date only.
 *
 * The subscription read stays off until after mount, and off entirely on
 * /billing. This banner sits in the shell, outside the page hydration
 * boundary. billing/loading.tsx lets that shell commit and run effects
 * while the page is still streaming, so a fetch started here creates the
 * shared billing query as pending. The page then hydrates against that
 * empty read instead of its server snapshot.
 */
export function AccessDeadlineBanner() {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (pathname === '/billing') return <AccessDeadlineFromCache />;
  return <AccessDeadlineBannerLive />;
}

function AccessDeadlineFromCache() {
  const client = useQueryClient();
  // The cache notifies while HydrationBoundary and the page render;
  // re-rendering this banner then is a setState-in-render. Deferred the
  // way useQuery defers its own observer notifications.
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client.getQueryCache().subscribe(notifyManager.batchCalls(onStoreChange)),
    [client],
  );
  const data = useSyncExternalStore(
    subscribe,
    () => client.getQueryData<BillingSubscription>(billingKeys.subscription()),
    () => undefined,
  );
  return <AccessDeadlineBody subscription={data} />;
}

function AccessDeadlineBannerLive() {
  const billing = useBillingSubscription();
  return <AccessDeadlineBody subscription={billing.data} />;
}

function AccessDeadlineBody({ subscription }: { subscription: BillingSubscription | undefined }) {
  const { tier } = useTier();
  const paymentMethod = usePaymentMethodSession();
  const banner = accessDeadlineCopy(tier, subscription?.subscription ?? null);
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
