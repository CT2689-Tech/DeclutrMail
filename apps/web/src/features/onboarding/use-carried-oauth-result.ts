'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';

import { OAUTH_RESULT_PARAMS, oauthResultIn } from '@/features/mailboxes/oauth-result';

/**
 * Show the OAuth result the onboarding gate carried here, once (D108).
 *
 * Someone who has not finished onboarding comes back from Google to a
 * Settings or Triage URL, and the gate sends them on to /onboarding with
 * the closed result. Without this, a reconnect that came back without
 * Gmail looked exactly like nothing had happened.
 *
 * Reads `window.location` rather than `useSearchParams` (value needed
 * once, client-side), then clears the params so a refresh does not replay
 * it, keeping any other query and the existing history state.
 */
export function useCarriedOAuthResult(): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const result = oauthResultIn(window.location.search);
    if (!result) return;
    toast(result.copy.message, result.copy.tone);

    const params = new URLSearchParams(window.location.search);
    for (const param of OAUTH_RESULT_PARAMS) params.delete(param);
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );
  }, []);
}
