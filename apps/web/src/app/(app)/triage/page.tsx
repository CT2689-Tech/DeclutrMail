'use client';

import { useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { TierGate } from '@/features/billing/tier-gate';
import { useTriageQueue, useTriageStats } from '@/features/triage/api/use-triage-queue';
import { composeTriageState } from '@/features/triage/compose-state';
import { TriageScreen } from '@/features/triage/triage-screen';
import { track } from '@/lib/posthog';

/**
 * Triage daily ritual route (D29, D33, D207).
 *
 * Composes the screen state from two live queries (`/api/triage/queue`
 * + `/api/triage/stats`). The `<TriageScreen state={...}/>` renderer
 * is fixture-shape compatible — the BE controllers return the same
 * JSON shapes the fixtures used, so the inner tree is unchanged.
 *
 * The connect-mailbox result toast (`?connected=<email>` /
 * `?connect_error=<code>`) used to be wired here, but a connect
 * FAILURE leaves `activeMailboxId` null, so the app chrome renders the
 * `NoActiveMailbox` reconnect takeover instead of this page — the toast
 * never ran (QA-onboarding-20260828-05). It now lives at the chrome
 * level (`app-chrome-layout.tsx`'s `useConnectResultToast`), above every
 * branch that decision can take.
 */
export default function TriagePage() {
  return (
    <TierGate
      capability="triage"
      title="Triage"
      pitch="Review a short queue of sender decisions with an exact action preview before Gmail changes."
      bullets={[
        'A focused daily sender queue',
        'Keep, Archive, Unsubscribe, Later, and Delete previews',
        'Activity records and eligible Undo controls',
      ]}
    >
      <TriageExperience />
    </TierGate>
  );
}

function TriageExperience() {
  const { me } = useAuth();
  const queue = useTriageQueue();
  const stats = useTriageStats();

  // D159 funnel — one page_viewed per triage route mount (billing-
  // screen pattern). Lives on the ROUTE, not `TriageScreen`: the
  // screen also renders inside onboarding step 5 and Storybook, where
  // a 'triage' page view would be a lie.
  useEffect(() => {
    void track('page_viewed', { page: 'triage', mailbox_id: me.activeMailboxId });
  }, [me.activeMailboxId]);

  const state = composeTriageState({
    rows: queue.data,
    stats: stats.data,
    isLoading: queue.isLoading || stats.isLoading,
    isError: queue.isError || stats.isError,
    error: queue.error ?? stats.error,
    retry: () => {
      void queue.refetch();
      void stats.refetch();
    },
  });
  return <TriageScreen state={state} />;
}
