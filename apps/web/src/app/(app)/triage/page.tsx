'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';
import { useTriageQueue, useTriageStats } from '@/features/triage/api/use-triage-queue';
import { TriageScreen } from '@/features/triage/triage-screen';
import type {
  TriageDecisionRow,
  TriageScreenState,
  TriageSessionStats,
} from '@/features/triage/data';

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

  const queue = useTriageQueue();
  const stats = useTriageStats();

  const state = composeState(queue.data, stats.data, queue.isLoading || stats.isLoading);
  return <TriageScreen state={state} />;
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

function composeState(
  rows: TriageDecisionRow[] | undefined,
  stats: TriageSessionStats | undefined,
  isLoading: boolean,
): TriageScreenState {
  if (isLoading || !stats) {
    return { kind: 'loading' };
  }
  if (!rows || rows.length === 0) {
    return { kind: 'empty', stats };
  }
  return { kind: 'ready', rows: [...rows], stats };
}
