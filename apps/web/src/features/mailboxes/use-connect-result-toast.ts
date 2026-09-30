'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';

import {
  onboardingGateVerdict,
  useOnboardingState,
} from '@/features/onboarding/api/use-onboarding';
import { replaceUrl } from '@/lib/replace-url';

import { CONNECT_ERROR_COPY, connectErrorCode } from './oauth-result';

/**
 * Reads `?connect_error` from the URL once on mount, fires the matching
 * toast, then clears the param so a manual refresh doesn't replay it.
 * Only closed codes reach the toast. A `?connected=<email>` success toast
 * used to show whatever text the URL carried; nothing sends that param (a
 * successful connect lands on `/onboarding?mailbox=`), so it is gone.
 *
 * Mounted at the app-chrome level (`app-chrome-layout.tsx`), not on a
 * specific page: a connect failure leaves `activeMailboxId` null, so the
 * chrome renders the `NoActiveMailbox` reconnect takeover instead of any
 * particular route's content — a toast wired to one page (Triage) never
 * ran on that branch, and the param dangled in the URL unexplained
 * (QA-onboarding-20260828-05). One mount, above every branch, covers all
 * of them.
 *
 * Uses `window.location` rather than `useSearchParams` to avoid the
 * Next.js "useSearchParams should be wrapped in a Suspense boundary"
 * build constraint — the value is only needed once, client-side.
 */
export function useConnectResultToast(): void {
  const fired = useRef(false);
  // Someone who has not finished onboarding is about to be sent to
  // /onboarding, and the gate carries this result there to show (D108).
  // Using it up here first would lose it. A failed read counts as done, so
  // the result still shows somewhere.
  const onboarded = onboardingGateVerdict(useOnboardingState()) === 'open';
  useEffect(() => {
    if (fired.current || typeof window === 'undefined' || !onboarded) return;
    fired.current = true;

    const params = new URLSearchParams(window.location.search);
    const connectError = params.get('connect_error');
    if (!connectError) return;

    toast(CONNECT_ERROR_COPY[connectErrorCode(connectError)]!, 'danger');

    // Strip the one-shot param without a navigation, through Next's router
    // so a later refresh cannot write it back (see replaceUrl).
    replaceUrl((url) => url.searchParams.delete('connect_error'));
  }, [onboarded]);
}
