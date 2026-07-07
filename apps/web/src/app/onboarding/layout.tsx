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

import type { ReactNode } from 'react';
import { CookieConsentBanner } from '@/features/consent/cookie-consent-banner';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* D147 consent ask — onboarding is a fresh visitor's first app
          surface, so the analytics opt-in must be answerable here too. */}
      <CookieConsentBanner />
    </>
  );
}
