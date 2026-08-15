// Onboarding route boundary (D134 split, restructured for D106-D108).
//
// `/onboarding` is no longer wrapped in `AuthProvider` at the layout —
// the first two steps of the D106 machine (Promise + Connect, D107/
// D108) are PRE-AUTH funnel surfaces: a fresh visitor must see the
// value promise and the privacy boundary BEFORE any Google consent,
// so a blocking `GET /api/auth/me` + 401→OAuth bounce here would
// defeat the screen's purpose.
//
// The page itself owns the boundary: it probes the session and mounts
// `AuthProvider` only around the authed steps (sync gate onward) and
// the secondary-connect gate. See `page.tsx`'s docblock.

// THEME SCRIPT (Option A′, founder 2026-08-14): `/onboarding` is listed
// in `AUTHED_APP_PATHS`, so middleware gives it the strict nonce +
// 'strict-dynamic' CSP. Under 'strict-dynamic' a host-source authorizes
// nothing, so the resolver runs only if it carries the nonce — read here
// because the root layout may no longer read `headers()` (doing so
// un-statics all 34 public pages). No `BillingCurrencyProvider`:
// onboarding quotes no price, so `useRegionProvider`'s own default
// stands.

import type { ReactNode } from 'react';
import { headers } from 'next/headers';

import { CookieConsentBanner } from '@/features/consent/cookie-consent-banner';
import { ThemeScript } from '@/features/theme/theme-script';

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <ThemeScript nonce={nonce} />
      {children}
      {/* D147 consent ask — onboarding is a fresh visitor's first app
          surface, so the analytics opt-in must be answerable here too. */}
      <CookieConsentBanner />
    </>
  );
}
