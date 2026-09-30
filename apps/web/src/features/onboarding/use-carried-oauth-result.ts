'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from '@declutrmail/shared';

import {
  OAUTH_RESULT_PARAMS,
  oauthResultIn,
  type OAuthResultCopy,
} from '@/features/mailboxes/oauth-result';
import { replaceUrl } from '@/lib/replace-url';

/**
 * Show the OAuth result the onboarding gate carried here, once (D108).
 *
 * Someone who has not finished onboarding comes back from Google to a
 * Settings or Triage URL, and the gate sends them on to /onboarding with
 * the closed result. Without this, a reconnect that came back without
 * Gmail looked exactly like nothing had happened.
 *
 * Returns the copy so the page can put it in live regions that were
 * already on screen: a toast's region arrives already holding its text,
 * which screen readers may not announce. Settings does the same.
 *
 * Waits for `signedIn`: only a signed-in session was carried here by the
 * gate, so a signed-out visit to a crafted URL shows nothing.
 *
 * Reads `window.location` rather than `useSearchParams` (value needed
 * once, client-side), then clears the params so a refresh does not replay
 * it, keeping any other query and the hash.
 */
export function useCarriedOAuthResult(signedIn: boolean): OAuthResultCopy | null {
  const fired = useRef(false);
  const [copy, setCopy] = useState<OAuthResultCopy | null>(null);
  useEffect(() => {
    if (fired.current || !signedIn) return;
    fired.current = true;

    const result = oauthResultIn(window.location.search);
    if (!result) return;
    setCopy(result.copy);
    toast(result.copy.message, result.copy.tone);

    replaceUrl((url) => {
      for (const param of OAUTH_RESULT_PARAMS) url.searchParams.delete(param);
    });
  }, [signedIn]);
  return copy;
}
