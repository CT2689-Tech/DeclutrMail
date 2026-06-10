'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { toast, UndoTray } from '@declutrmail/shared';
import type { UndoTrayDataSource, UndoTrayEntry } from '@declutrmail/shared';

import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { useActionStatus, useRevertUndo } from '@/lib/api/use-action';
import { ApiError, apiGet } from '@/lib/api/client';
import { isTerminalStatus } from '@/lib/api/actions';

import { TRIAGE_QUEUE_KEY, TRIAGE_STATS_KEY } from './api/use-triage-queue';
import { useTriageStore } from './store';

/**
 * Undo-tray query key. Not partitioned by mailbox — reads resolve the
 * active mailbox server-side (`CurrentMailboxGuard`) and every mailbox
 * switch runs `resetMailboxScopedCache` (invalidate-all), so a scoped
 * key would be redundant (same contract as the triage/senders keys).
 */
export const UNDO_TRAY_QUERY_KEY = ['undo', 'tray'] as const;

/**
 * Mark every surface a confirmed undo touches as stale: the tray
 * itself (token now reverted), the triage queue (the reverted sender
 * is no longer "decided", so it returns to the queue), stats, the
 * activity feed, and the senders list (inbox counts moved back).
 */
export function invalidateAfterUndo(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: UNDO_TRAY_QUERY_KEY });
  void qc.invalidateQueries({ queryKey: TRIAGE_QUEUE_KEY });
  void qc.invalidateQueries({ queryKey: TRIAGE_STATS_KEY });
  void qc.invalidateQueries({ queryKey: activityKeys.all });
  void qc.invalidateQueries({ queryKey: sendersKeys.all });
}

/**
 * Active undo tokens for the current mailbox (D35 tray data source).
 *
 * Why not the shared `useUndoTray` live path: its raw `fetch` does not
 * attach the `X-CSRF-Token` double-submit header, and `POST
 * /api/undo/:token` sits behind `CsrfGuard` — the shared hook's revert
 * would 403 in the app. This adapter routes through the app's API
 * client (CSRF + base URL + 401-refresh) and feeds the shared
 * `<UndoTray>` via its `dataSource` seam.
 */
function useUndoEntries() {
  return useQuery({
    queryKey: UNDO_TRAY_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const env = await apiGet<UndoTrayEntry[]>('/api/undo', { signal });
      return env.data;
    },
    // The tray must react to actions taken in another tab (D35).
    // `makeQueryClient` opts out of refetch-on-focus globally; this
    // hook opts back in, debounced by staleTime (mirrors the shared
    // hook's rationale).
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

/**
 * The persistent undo tray on the Triage surface (D35).
 *
 *   - Lists active undo tokens via `GET /api/undo`, newest first.
 *   - Per-row Undo reverses by token: `POST /api/undo/:token` enqueues
 *     a reverse job that is polled until terminal — the entry leaves
 *     the tray for good only on server confirmation, and the triage
 *     queue refetches so the reverted sender returns to it.
 *   - `Z` undoes the newest entry (D35 power-user shortcut). Same
 *     input-field guards as the K/A/U/L shortcuts in
 *     `action-toolbar.tsx`; suppressed while an action sheet / inline
 *     preview is open (the pending-action surface owns the keyboard).
 *
 * Toast discipline (D35 / Doc 05 §7): decisions never toast — the
 * tray IS the decision feedback. Undo completion and failures DO
 * toast: the tray row is already gone, so there is no other channel.
 */
export function TriageUndoTray() {
  const qc = useQueryClient();
  const router = useRouter();
  const entriesQuery = useUndoEntries();
  const revert = useRevertUndo();
  const pendingAction = useTriageStore((s) => s.pendingAction);

  /**
   * The one revert in flight (click/Z → POST → poll). Single slot —
   * a second undo while one is confirming is dropped, mirroring the
   * single `activeAction` slot on the action side.
   */
  const [inFlight, setInFlight] = useState<{ token: string; actionId: string | null } | null>(null);
  const revertStatus = useActionStatus(inFlight?.actionId ?? null);

  const revertToken = useCallback(
    async (token: string): Promise<void> => {
      if (inFlight != null || revert.isPending) return;
      // Hide the entry while the revert confirms; a failure puts it back.
      setInFlight({ token, actionId: null });
      try {
        const res = await revert.mutateAsync({ token });
        if (res.reverted) {
          // Idempotent replay — already reverted server-side.
          toast('Restored to your inbox', 'success');
          setInFlight(null);
          invalidateAfterUndo(qc);
        } else if (res.actionId) {
          // Reverse job enqueued — poll it (effect below).
          setInFlight({ token, actionId: res.actionId });
        } else {
          // BE-designed terminal: nothing to revert.
          toast('Nothing to undo — already restored.', 'info');
          setInFlight(null);
          invalidateAfterUndo(qc);
        }
      } catch (err) {
        toast(
          err instanceof ApiError && err.status === 410
            ? 'Undo window has expired'
            : "Couldn't undo — see Activity",
          'warn',
        );
        setInFlight(null);
        void qc.invalidateQueries({ queryKey: UNDO_TRAY_QUERY_KEY });
      }
    },
    [inFlight, revert, qc],
  );

  // Reverse-job lifecycle — terminal only on server confirmation.
  // `useActionStatus` runs with `retry: false` (read-4xx rule, §8), so
  // a sustained poll failure surfaces via `isError` and breaks the
  // latch instead of spinning forever.
  useEffect(() => {
    if (!inFlight?.actionId) return;
    if (revertStatus.isError) {
      toast("Couldn't confirm undo — see Activity", 'warn');
      setInFlight(null);
      void qc.invalidateQueries({ queryKey: UNDO_TRAY_QUERY_KEY });
      return;
    }
    const data = revertStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast('Restored to your inbox', 'success');
      invalidateAfterUndo(qc);
    } else {
      toast("Couldn't undo — see Activity", 'warn');
      void qc.invalidateQueries({ queryKey: UNDO_TRAY_QUERY_KEY });
    }
    setInFlight(null);
  }, [revertStatus.data, revertStatus.isError, inFlight, qc]);

  // Entries shown — the in-flight token is hidden until its revert
  // settles (failure paths clear `inFlight`, so it reappears).
  const entries = (entriesQuery.data ?? []).filter((entry) => entry.token !== inFlight?.token);

  // Z — undo last (D35). Same typing guards as `resolveShortcut` in
  // action-toolbar.tsx; the pending-action surface owns the keyboard
  // while a sheet / inline preview is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toUpperCase() !== 'Z') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (pendingAction != null) return;
      const newest = entries[0];
      if (!newest) return;
      e.preventDefault();
      void revertToken(newest.token);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, pendingAction, revertToken]);

  const dataSource: UndoTrayDataSource = {
    entries,
    isLoading: entriesQuery.isLoading,
    isError: entriesQuery.isError,
    error: entriesQuery.error ?? null,
    revert: revertToken,
  };

  return <UndoTray dataSource={dataSource} onViewActivity={() => router.push('/activity')} />;
}
