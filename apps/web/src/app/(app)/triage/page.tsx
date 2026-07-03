'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { useTriageQueue, useTriageStats } from '@/features/triage/api/use-triage-queue';
import { composeTriageState } from '@/features/triage/compose-state';
import { TriageScreen } from '@/features/triage/triage-screen';
import { TriageUndoTray } from '@/features/triage/triage-undo-tray';
import { track } from '@/lib/posthog';

/**
 * Triage daily ritual route (D29, D33, D207).
 *
 * Composes the screen state from two live queries (`/api/triage/queue`
 * + `/api/triage/stats`). The `<TriageScreen state={...}/>` renderer
 * is fixture-shape compatible — the BE controllers return the same
 * JSON shapes the fixtures used, so the inner tree is unchanged.
 *
 * Connect-mailbox result toast: the OAuth connect-mailbox flow
 * (account menu → "Connect another Gmail") redirects back here with
 * `?connected=<email>` on success or `?connect_error=<code>` on
 * failure (e.g. the Google account already belongs to another
 * workspace). `useConnectResultToast` surfaces that as a toast and
 * strips the query param so a refresh doesn't re-fire it.
 */
export default function TriagePage() {
  useConnectResultToast();

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
  return (
    <>
      <TriageScreen state={state} />
      {/* D35 — the persistent undo tray lives on the triage surface
          across EVERY state (it must survive the queue emptying). The
          (app) layout guarantees an active mailbox on this route. */}
      {me.activeMailboxId != null && <TriageUndoTray />}
    </>
  );
}

/** Human copy for each `connect_error` code the BE can redirect with. */
const CONNECT_ERROR_COPY: Record<string, string> = {
  MAILBOX_OWNED_BY_OTHER_WORKSPACE:
    'That Gmail account is already connected to a different DeclutrMail workspace.',
  connect_failed: 'Could not connect that Gmail account. Try again.',
};

/**
 * Reads `?connected` / `?connect_error` from the URL once on mount,
 * fires the matching toast, then clears the param via
 * `history.replaceState` so a manual refresh doesn't replay it.
 *
 * Uses `window.location` rather than `useSearchParams` to avoid the
 * Next.js "useSearchParams should be wrapped in a Suspense boundary"
 * build constraint — the value is only needed once, client-side.
 */
function useConnectResultToast(): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || typeof window === 'undefined') return;
    fired.current = true;

    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connectError = params.get('connect_error');
    if (!connected && !connectError) return;

    if (connected) {
      toast(`Connected ${connected}.`, 'success');
    } else if (connectError) {
      toast(CONNECT_ERROR_COPY[connectError] ?? 'Could not connect that account.', 'danger');
    }

    // Strip the one-shot params without a navigation.
    params.delete('connected');
    params.delete('connect_error');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);
}
