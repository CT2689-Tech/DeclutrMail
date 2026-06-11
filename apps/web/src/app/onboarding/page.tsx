'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { SyncGate, type SyncGateEscape } from '@/features/onboarding/sync-gate';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useAuth } from '@/features/auth/auth-provider';
import { useSetActiveMailbox } from '@/features/mailboxes/api/use-set-active-mailbox';

/**
 * Onboarding sync-gate route (D6, D109, D116, D224).
 *
 * Full-screen gate shown after a Gmail connect. Polls the real sync
 * state via `useSyncStatus` and auto-advances to `/senders` the moment
 * the backend reports `is_ready_for_triage`.
 *
 * Two entry shapes:
 *   - First-run signup → `/onboarding` (no `?mailbox`). Gates the only
 *     mailbox; no escape hatch (nothing to return to) — the strict
 *     single-mailbox gate (D6) is preserved.
 *   - Secondary connect → `/onboarding?mailbox=<id>` (D116). Gates THAT
 *     mailbox explicitly (so it survives the user switching back), and
 *     offers a "Go back to <primary>" escape hatch.
 *
 * Lives OUTSIDE the `(app)` route group on purpose: the gate is pre-app
 * chrome. It is still authenticated — this route's own `layout.tsx`
 * wraps the subtree in `AuthProvider` (D134 split: the root providers
 * no longer auth-gate every route), so `useAuth()` is available and an
 * unauthd hit bounces to the OAuth start endpoint.
 *
 * `useSearchParams` requires a Suspense boundary in the App Router, so
 * the gate body is split into an inner client component.
 */
export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingGate />
    </Suspense>
  );
}

function OnboardingGate() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useAuth();
  const setActive = useSetActiveMailbox();

  // Gate target: the explicit `?mailbox` (secondary connect) or the
  // session's active mailbox (first-run). Polled by explicit id so a
  // later switch-back doesn't lose track of it.
  const gateMailboxId = params.get('mailbox') ?? me.activeMailboxId ?? undefined;
  const sync = useSyncStatus(gateMailboxId);

  const ready = sync.data?.is_ready_for_triage ?? false;

  useEffect(() => {
    if (ready) {
      // Land on Senders, not Triage: post-sync Senders has real data
      // immediately, whereas Triage is empty until the scoring pipeline
      // (D20/D25) runs.
      router.replace('/senders');
    }
  }, [ready, router]);

  // Escape hatch only when ANOTHER active mailbox exists to return to —
  // i.e. this is a secondary connect, not first-run.
  const other = me.mailboxes.find((m) => m.status === 'active' && m.id !== gateMailboxId);
  const escape: SyncGateEscape | undefined = other
    ? {
        returnToEmail: other.email,
        returning: setActive.isPending,
        onReturn: () => {
          setActive.mutate(other.id, { onSuccess: () => router.replace('/senders') });
        },
      }
    : undefined;

  // Initial load (no data yet) renders the gate in its queued shape so
  // there's no blank flash; once `useSyncStatus` resolves, the real
  // status drives it.
  const status = sync.data ?? {
    readiness_status: 'queued' as const,
    current_stage: 'queued' as const,
    progress_pct: 0,
    is_ready_for_triage: false,
  };

  return <SyncGate status={status} escape={escape} />;
}
