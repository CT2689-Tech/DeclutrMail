// Onboarding auth boundary (D134 public-route split).
//
// `/onboarding` is pre-app chrome (no AppShell) but still an authed
// surface — the sync gate reads `useAuth()` for the session's
// mailboxes. Since the root `providers.tsx` no longer wraps every
// route in AuthProvider, this layout supplies it for the onboarding
// subtree. An unauthd hit bounces to the OAuth start endpoint exactly
// as before (AuthProvider handles the 401 redirect).

'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/features/auth/auth-provider';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
