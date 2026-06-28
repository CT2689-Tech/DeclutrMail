'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useOnboardingState } from './api/use-onboarding';

/**
 * Returning-user strict gate (D6, D109, D113).
 *
 * Mounted inside the AUTHED `(app)` chrome (below `AuthProvider`), it
 * bounces any user whose onboarding is incomplete
 * (`users.onboarded_at IS NULL`) back to `/onboarding`, where the
 * D106 step machine resumes the correct step from server state —
 * including the mid-initial-sync returner the strict gate exists for.
 *
 * INTEGRATION (the one-line mount, owned by the integration PR since
 * `(app)/layout.tsx` is integration-owned):
 *
 *   // in AppChrome(), next to the other hooks:
 *   const onboardingGate = useOnboardingGate();
 *   …
 *   if (onboardingGate.gating) return null;  // optional skeleton
 *
 * ROLLOUT NOTE: `onboarded_at` is a new column — EXISTING users are
 * NULL until backfilled. Mounting this gate routes them through
 * steps 4-5 once (~30s, mailboxes already ready). If that's not
 * wanted, backfill before mounting:
 *   UPDATE users u SET onboarded_at = now()
 *   WHERE onboarded_at IS NULL AND EXISTS (
 *     SELECT 1 FROM mailbox_accounts m
 *     WHERE m.user_id = u.id AND m.status = 'active');
 *
 * Failure posture: a failed state read does NOT gate (fail-open) —
 * locking every user out of the app because one read failed is the
 * worse failure mode; the onboarding flow itself re-checks on entry.
 */
export function useOnboardingGate(): { gating: boolean; resolving: boolean } {
  const router = useRouter();
  const state = useOnboardingState();

  const shouldGate = state.data !== undefined && state.data.onboardedAt === null;
  // In flight: no data yet and not errored. On error → false (fail-open;
  // never hold the app forever on a failed read).
  const resolving = state.data === undefined && !state.isError;

  useEffect(() => {
    if (shouldGate) {
      router.replace('/onboarding');
    }
  }, [shouldGate, router]);

  return { gating: shouldGate, resolving };
}
