'use client';

import { useEffect } from 'react';

import { CONSENT_CHANGE_EVENT } from '@/lib/cookie-consent';
import { identifyUser } from '@/lib/posthog';
import { setAnalyticsPlan } from '@/lib/analytics-context';
import type { Tier } from './api/use-me';

/**
 * Joins consented anonymous acquisition events to the authenticated user by
 * internal UUID only. `identifyUser` enforces the consent gate, so the first
 * call is a no-op for an undecided/essential-only browser; listening for the
 * consent event lets an in-session "Accept all" choice retry immediately.
 */
export function useAnalyticsIdentity(userId: string, signupRef?: string | null, tier?: Tier) {
  useEffect(() => {
    setAnalyticsPlan(tier);
    const identify = () =>
      signupRef
        ? void identifyUser(userId, { signup_attribution_ref: signupRef })
        : void identifyUser(userId);
    identify();
    window.addEventListener(CONSENT_CHANGE_EVENT, identify);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, identify);
      setAnalyticsPlan(undefined);
    };
  }, [userId, signupRef, tier]);
}

export function AnalyticsIdentityBridge({ userId }: { userId: string }) {
  useAnalyticsIdentity(userId);

  return null;
}
