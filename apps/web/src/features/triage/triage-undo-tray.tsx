'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { toast, UndoTray } from '@declutrmail/shared';
import type { UndoTrayDataSource, UndoTrayEntry } from '@declutrmail/shared';

import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { undoKeys } from '@/features/undo/query-keys';
import { useActionStatus, useRevertUndo } from '@/lib/api/use-action';
import { ApiError, apiGet } from '@/lib/api/client';
import { isTerminalStatus } from '@/lib/api/actions';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import { track } from '@/lib/posthog';
import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';

import { TRIAGE_QUEUE_KEY, TRIAGE_STATS_KEY } from './api/use-triage-queue';
import { useTriageStore } from './store';

/**
 * Mark every surface a confirmed undo touches as stale: the tray
 * itself (token now reverted), the triage queue (the reverted sender
 * is no longer "decided", so it returns to the queue), stats, the
 * activity feed, and the senders list (inbox counts moved back).
 */
export function invalidateAfterUndo(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: undoKeys.all });
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
function useUndoEntries(mailboxId?: string) {
  return useQuery({
    queryKey: undoKeys.tray(mailboxId),
    queryFn: async ({ signal }) => {
      const env = await apiGet<UndoTrayEntry[]>('/api/undo', {
        signal,
        ...(mailboxId ? { mailboxId } : {}),
      });
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
 * The persistent product-wide undo tray (D35, D245).
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
export function ProductUndoTray({
  enableShortcut = false,
  mailboxId,
}: {
  enableShortcut?: boolean;
  mailboxId?: string | undefined;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const entriesQuery = useUndoEntries(mailboxId);
  const revert = useRevertUndo();
  const pendingAction = useTriageStore((s) => s.pendingAction);

  /**
   * The one revert in flight (click/Z → POST → poll). Single slot —
   * a second undo while one is confirming is dropped, mirroring the
   * single `activeAction` slot on the action side.
   */
  const [inFlight, setInFlight] = useState<{ token: string; actionId: string | null } | null>(null);
  const revertStatus = useActionStatus(inFlight?.actionId ?? null, mailboxId);
  const mailboxGeneration = useRef(0);

  // A capability from mailbox A must never stay hidden/polling after the
  // chrome switches to mailbox B. Onboarding intentionally omits the prop;
  // its single-mailbox mount therefore retains the original behavior.
  useEffect(() => {
    mailboxGeneration.current += 1;
    setInFlight(null);
    return () => {
      mailboxGeneration.current += 1;
    };
  }, [mailboxId]);

  const revertToken = useCallback(
    async (token: string): Promise<void> => {
      if (inFlight != null || revert.isPending) return;
      const generation = mailboxGeneration.current;
      // D159 — fires at CLICK time (row button or Z), once per attempt
      // (the single-slot guard above already dedupes re-clicks). Only
      // the entry's kind + age ship; the token itself is a live
      // capability and never reaches telemetry.
      const entry = entriesQuery.data?.find((e) => e.token === token);
      if (entry) {
        void track('undo_clicked', {
          verb: entry.actionKind,
          age_ms: Date.now() - new Date(entry.createdAt).getTime(),
        });
      }
      // Hide the entry while the revert confirms; a failure puts it back.
      setInFlight({ token, actionId: null });
      try {
        const res = await revert.mutateAsync({ token, ...(mailboxId ? { mailboxId } : {}) });
        // A mailbox switch/unmount owns the next surface. The old request
        // may finish server-side, but it must not toast or seed a poller in
        // the newly active mailbox.
        if (mailboxGeneration.current !== generation) return;
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
        if (mailboxGeneration.current !== generation) return;
        toast(
          err instanceof ApiError && err.status === 410
            ? 'Undo window has expired'
            : getActionFailureCopy('revert-enqueue').message,
          'warn',
        );
        setInFlight(null);
        void qc.invalidateQueries({ queryKey: undoKeys.all });
      }
    },
    [inFlight, revert, mailboxId, qc, entriesQuery.data],
  );

  // Reverse-job lifecycle — terminal only on server confirmation.
  // `useActionStatus` runs with `retry: false` (read-4xx rule, §8), so
  // a sustained poll failure surfaces via `isError` and breaks the
  // latch instead of spinning forever.
  useEffect(() => {
    if (!inFlight?.actionId) return;
    if (revertStatus.isError) {
      toast(getActionFailureCopy('revert-status').message, 'warn');
      setInFlight(null);
      void qc.invalidateQueries({ queryKey: undoKeys.all });
      return;
    }
    const data = revertStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast('Restored to your inbox', 'success');
      invalidateAfterUndo(qc);
    } else {
      toast(getActionFailureCopy('revert-terminal').message, 'warn');
      void qc.invalidateQueries({ queryKey: undoKeys.all });
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
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toUpperCase() !== 'Z') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (!enableShortcut) return;
      if (overlayOwnsKeyboard(target)) return;
      if (pendingAction != null) return;
      const newest = entries[0];
      if (!newest) return;
      e.preventDefault();
      void revertToken(newest.token);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableShortcut, entries, pendingAction, revertToken]);

  const dataSource: UndoTrayDataSource = {
    entries,
    isLoading: entriesQuery.isLoading,
    isError: entriesQuery.isError,
    error: entriesQuery.error ?? null,
    revert: revertToken,
  };

  return (
    <UndoTray
      dataSource={dataSource}
      onViewActivity={() => router.push('/activity')}
      style={{
        bottom: floatingSurfaceLayout.undoTrayBottom,
        zIndex: floatingSurfaceLayout.undoTrayZIndex,
      }}
    />
  );
}

/** True when a modal/dialog or an open/focused menu owns keyboard input. */
function overlayOwnsKeyboard(target: HTMLElement | null): boolean {
  const ownerSelector = '[role="dialog"], [aria-modal="true"], [role="menu"]';
  const focused =
    target instanceof Element
      ? target
      : document.activeElement instanceof Element
        ? document.activeElement
        : null;
  if (focused?.closest(ownerSelector)) return true;

  return Array.from(document.querySelectorAll<HTMLElement>(ownerSelector)).some((surface) => {
    if (surface.hidden || surface.getAttribute('aria-hidden') === 'true') return false;
    // App menus and dialogs mount only while open. If a future surface
    // keeps one mounted, hidden/aria-hidden above is its closed contract.
    return true;
  });
}

/** Triage/onboarding wrapper retains the original Z-key behavior. */
export function TriageUndoTray({ mailboxId }: { mailboxId?: string | undefined } = {}) {
  return <ProductUndoTray enableShortcut mailboxId={mailboxId} />;
}
