'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { SyncGate } from '@/features/onboarding/sync-gate';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';

/**
 * Onboarding sync-gate route (D6, D109, D224).
 *
 * Full-screen gate shown after a Gmail connect. Polls the real sync
 * state via `useSyncStatus` and auto-advances to `/triage` the moment
 * the backend reports `is_ready_for_triage` — the D109 "auto-advances
 * to Step 4 when readiness = ready" behaviour (Step 4 / style-preset
 * is D110, not yet built, so we advance straight to the daily ritual).
 *
 * Lives OUTSIDE the `(app)` route group on purpose: the gate is
 * pre-app chrome (no sidebar / trust strip), and a half-synced mailbox
 * must not reach the app shell. It is still authenticated — the root
 * `AuthProvider` (providers.tsx) wraps every route, so an unauthd hit
 * here bounces to the OAuth start endpoint.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const sync = useSyncStatus();

  const ready = sync.data?.is_ready_for_triage ?? false;

  useEffect(() => {
    if (ready) {
      // Land on Senders, not Triage: post-sync Senders has real data
      // immediately, whereas Triage is empty until the scoring pipeline
      // (D20/D25) runs. Matches the root redirect (/senders) + the
      // OAuth returning-user target.
      router.replace('/senders');
    }
  }, [ready, router]);

  // Initial load (no data yet) renders the gate in its queued shape so
  // there's no blank flash; once `useSyncStatus` resolves, the real
  // status drives it.
  const status = sync.data ?? {
    readiness_status: 'queued' as const,
    current_stage: 'queued' as const,
    progress_pct: 0,
    is_ready_for_triage: false,
  };

  return <SyncGate status={status} />;
}
