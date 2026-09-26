'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';

import { useOnboardingState } from '@/features/onboarding/api/use-onboarding';

import { CONNECT_ERROR_COPY } from './oauth-result';

/**
 * Reads `?connected` / `?connect_error` from the URL once on mount, fires
 * the matching toast, then clears the param via `history.replaceState` so
 * a manual refresh doesn't replay it.
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
  const onboarding = useOnboardingState();
  const onboarded =
    onboarding.isError || (onboarding.data !== undefined && onboarding.data.onboardedAt !== null);
  useEffect(() => {
    if (fired.current || typeof window === 'undefined' || !onboarded) return;
    fired.current = true;

    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connectError = params.get('connect_error');
    if (!connected && !connectError) return;

    if (connected) {
      toast(`Connected ${connected}.`, 'success');
    } else if (connectError) {
      toast(CONNECT_ERROR_COPY[connectError] ?? 'Could not connect that account.', 'danger');
    }

    // Strip the one-shot params without a navigation. Preserves the
    // existing history state (Codex adversarial review, round 2, matching
    // `settings-screen.tsx`'s own `reconnect_result` scrub) — this hook
    // now mounts above the whole branch ladder, not one page, so an
    // overwritten `null` state would reach every `(app)` route.
    params.delete('connected');
    params.delete('connect_error');
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + (qs ? `?${qs}` : ''),
    );
  }, [onboarded]);
}
