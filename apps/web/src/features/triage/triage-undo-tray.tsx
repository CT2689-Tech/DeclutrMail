'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { toast, UndoTray } from '@declutrmail/shared';
import type { UndoTrayDataSource, UndoTrayEntry } from '@declutrmail/shared';

import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { undoKeys } from '@/features/undo/query-keys';
import { undoEntriesQueryOptions } from '@/features/undo/query-options';
import { useActionStatus, useRevertUndo, useRevertUndoMember } from '@/lib/api/use-action';
import { ApiError, apiGet } from '@/lib/api/client';
import { isTerminalStatus } from '@/lib/api/actions';
import { getActionFailureCopy, UNDO_DONE_TOAST } from '@/lib/action-error-copy';
import { track } from '@/lib/posthog';
import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';

import { TRIAGE_BOOTSTRAP_KEY } from './api/use-triage-queue';
import { useTriageStore } from './store';

/**
 * Mark every surface a confirmed undo touches as stale: the tray
 * itself (token now reverted), the triage queue (the reverted sender
 * is no longer "decided", so it returns to the queue), stats, the
 * activity feed, and the senders list (inbox counts moved back).
 */
export function invalidateAfterUndo(qc: QueryClient): Promise<void> {
  // The tray list's refetch is RETURNED: the tray keeps its revert slot
  // latched until the refreshed list lands (see `ProductUndoTray`).
  const trayRefreshed = qc.invalidateQueries({ queryKey: undoKeys.all });
  // One key: the queue, the stats and the Today strip share a cache entry,
  // so a reverted undo restores all three from the same read.
  void qc.invalidateQueries({ queryKey: TRIAGE_BOOTSTRAP_KEY });
  void qc.invalidateQueries({ queryKey: activityKeys.all });
  void qc.invalidateQueries({ queryKey: sendersKeys.all });
  return trayRefreshed;
}

/**
 * A decision's stable identity. `token` is only "a member token that
 * reverts the decision" and moves when that member is undone, so the
 * baseline and the in-flight hide key on `groupId`. An API predating the
 * decision-grouped list sends no `groupId`; there one token IS one row.
 */
const decisionId = (entry: UndoTrayEntry): string => entry.groupId ?? entry.token;

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
  return useQuery(
    undoEntriesQueryOptions(mailboxId, async (signal) => {
      const env = await apiGet<UndoTrayEntry[]>('/api/undo', {
        signal,
        ...(mailboxId ? { mailboxId } : {}),
      });
      return env.data;
    }),
  );
}

/**
 * The persistent product-wide undo tray (D35, D245).
 *
 *   - Lists undoable DECISIONS via `GET /api/undo`, newest first — a
 *     bulk action is one row, named and counted.
 *   - Per-row Undo reverses the whole decision: `POST /api/undo/:token`
 *     enqueues a reverse job that is polled until terminal — the entry
 *     leaves the tray for good only on server confirmation, and the
 *     triage queue refetches so the reverted sender returns to it.
 *   - Inside a bulk decision, a sender's own Undo reverses just that
 *     sender (`POST /api/undo/:token/action`), same poll, same slot.
 *   - `Z` undoes the newest entry (D35 power-user shortcut). Same
 *     input-field guards as the K/A/U/L shortcuts in
 *     `action-toolbar.tsx`; suppressed while an action sheet / inline
 *     preview is open (the pending-action surface owns the keyboard).
 *
 * Toast discipline (D35 / Doc 05 §7): decisions never toast — the
 * tray IS the decision feedback. Undo completion and failures DO
 * toast: the tray row is already gone, so there is no other channel.
 *
 * Scope (D35 "tray persists during the session"): the tray shows the
 * decisions YOU took on the screen you are on — not every live undo
 * token. `GET /api/undo` returns tokens for their whole window, and
 * Delete's is 5 days (ADR-0019), so rendering that list unfiltered
 * pinned "Moved to Gmail Trash" over Autopilot, Quiet and Billing for
 * days after the act, and greeted the next session with it. Long-tail
 * undo is Activity's job — which is exactly what the row's "Activity
 * Undo until …" line and the footer link already point at.
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
  const pathname = usePathname();
  const entriesQuery = useUndoEntries(mailboxId);
  const revert = useRevertUndo();
  const revertMember = useRevertUndoMember();
  const pendingAction = useTriageStore((s) => s.pendingAction);

  /**
   * The one revert in flight (click/Z → POST → poll). Single slot —
   * a second undo while one is confirming is dropped, mirroring the
   * single `activeAction` slot on the action side.
   */
  const [inFlight, setInFlight] = useState<{
    /** The decision being reverted — hidden whole unless `memberToken` is set. */
    id: string;
    /** Set when only ONE sender of the decision is being reverted. */
    memberToken: string | null;
    actionId: string | null;
  } | null>(null);
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

  /**
   * After a CONFIRMED undo, free the revert slot only once the refreshed
   * list has landed. Until then the cached rows still carry the token
   * that was just spent: "Undo all" (or Z) in that gap POSTs a reverted
   * token, the API answers `reverted: true`, and the tray toasted
   * success while the remaining senders were never touched. Reachable
   * only since a one-sender undo leaves its decision's row on screen.
   *
   * `actionId: null` stops the status poll while the slot stays taken.
   */
  const releaseAfterRefresh = useCallback(
    (generation: number) => {
      setInFlight((current) => (current ? { ...current, actionId: null } : current));
      void invalidateAfterUndo(qc).finally(() => {
        if (mailboxGeneration.current === generation) setInFlight(null);
      });
    },
    [qc],
  );

  const revertToken = useCallback(
    async (token: string, scope: 'decision' | 'member' = 'decision'): Promise<void> => {
      if (inFlight != null || revert.isPending || revertMember.isPending) return;
      const generation = mailboxGeneration.current;
      // D159 — fires at CLICK time (row button or Z), once per attempt
      // (the single-slot guard above already dedupes re-clicks). Only
      // the entry's kind + age ship; the token itself is a live
      // capability and never reaches telemetry.
      const entry = entriesQuery.data?.find((e) =>
        scope === 'member' ? e.members?.some((m) => m.token === token) : e.token === token,
      );
      // A member click whose decision is gone from the cache (a refetch
      // landed between render and click) has nothing to hide and nothing
      // to show for itself — taking the slot would swallow every retry
      // with no visible feedback. The refreshed list is the answer.
      if (scope === 'member' && !entry) return;
      if (entry) {
        const member =
          scope === 'member' ? entry.members?.find((m) => m.token === token) : undefined;
        void track('undo_clicked', {
          verb: member?.actionKind ?? entry.actionKind,
          age_ms: Date.now() - new Date(entry.createdAt).getTime(),
        });
      }
      // Hide the entry (or the one sender) while the revert confirms; a
      // failure puts it back.
      const hidden = {
        id: entry ? decisionId(entry) : token,
        memberToken: scope === 'member' ? token : null,
      };
      setInFlight({ ...hidden, actionId: null });
      try {
        const res =
          scope === 'member'
            ? await revertMember.mutateAsync({
                memberToken: token,
                ...(mailboxId ? { mailboxId } : {}),
              })
            : await revert.mutateAsync({ token, ...(mailboxId ? { mailboxId } : {}) });
        // A mailbox switch/unmount owns the next surface. The old request
        // may finish server-side, but it must not toast or seed a poller in
        // the newly active mailbox.
        if (mailboxGeneration.current !== generation) return;
        if (res.reverted) {
          // Idempotent replay — already reverted server-side.
          toast(UNDO_DONE_TOAST, 'success');
          releaseAfterRefresh(generation);
        } else if (res.actionId) {
          // Reverse job enqueued — poll it (effect below).
          setInFlight({ ...hidden, actionId: res.actionId });
        } else {
          // BE-designed terminal: nothing to revert.
          toast('Nothing to undo — already restored.', 'info');
          releaseAfterRefresh(generation);
        }
      } catch (err) {
        if (mailboxGeneration.current !== generation) return;
        toast(
          err instanceof ApiError && err.status === 410
            ? 'Undo window has expired'
            : getActionFailureCopy('revert-enqueue'),
          'warn',
        );
        setInFlight(null);
        void qc.invalidateQueries({ queryKey: undoKeys.all });
      }
    },
    [inFlight, revert, revertMember, mailboxId, qc, entriesQuery.data, releaseAfterRefresh],
  );

  // Reverse-job lifecycle — terminal only on server confirmation.
  // `useActionStatus` runs with `retry: false` (read-4xx rule, §8), so
  // a sustained poll failure surfaces via `isError` and breaks the
  // latch instead of spinning forever.
  useEffect(() => {
    if (!inFlight?.actionId) return;
    if (revertStatus.isError) {
      toast(getActionFailureCopy('revert-status'), 'warn');
      setInFlight(null);
      void qc.invalidateQueries({ queryKey: undoKeys.all });
      return;
    }
    const data = revertStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast(UNDO_DONE_TOAST, 'success');
      releaseAfterRefresh(mailboxGeneration.current);
      return;
    }
    toast(getActionFailureCopy('revert-terminal'), 'warn');
    void qc.invalidateQueries({ queryKey: undoKeys.all });
    setInFlight(null);
  }, [revertStatus.data, revertStatus.isError, inFlight, qc, releaseAfterRefresh]);

  /**
   * Tokens already live when this screen was entered — the tray's
   * baseline. Anything in it is history rather than feedback for
   * something done HERE, so it stays hidden; the tray fills up again
   * from the next action on this screen.
   *
   * Identity, not timestamps. `entry.createdAt` is SERVER clock and any
   * epoch we captured would be BROWSER clock, so seconds of skew either
   * leak stale rows or — far worse — swallow the row for the action just
   * taken, and decisions have no other feedback channel (D35 bans toasts
   * for them). Token identity cannot skew.
   *
   * Keyed on the mailbox too: query data is per-mailbox, so a switch
   * without a re-baseline would expose every live token of the mailbox
   * switched INTO — the same defect on a different axis.
   *
   * Set during render, not in an effect: effects commit after paint, so
   * an effect would flash the stale rows for a frame on every route
   * change. Self-limiting — the scope check is false immediately after.
   */
  const trayScope = `${pathname}\u0000${mailboxId ?? ''}`;
  const [baseline, setBaseline] = useState<{
    scope: string;
    tokens: ReadonlySet<string>;
  } | null>(null);
  if (entriesQuery.data && baseline?.scope !== trayScope) {
    setBaseline({ scope: trayScope, tokens: new Set(entriesQuery.data.map(decisionId)) });
  }

  // Entries shown — the in-flight decision is hidden until its revert
  // settles (failure paths clear `inFlight`, so it reappears). A
  // one-sender revert hides only that sender, and takes its mail out of
  // the headline: a line still reading "440 emails · 2 senders" while one
  // of them is on its way back would be a count the row no longer holds.
  const entries = (entriesQuery.data ?? [])
    .filter((entry) => !baseline?.tokens.has(decisionId(entry)))
    .flatMap((entry): UndoTrayEntry[] => {
      if (inFlight == null || decisionId(entry) !== inFlight.id) return [entry];
      if (inFlight.memberToken === null) return [];
      const leaving = entry.members?.find((m) => m.token === inFlight.memberToken);
      if (!leaving || !entry.members) return [entry];
      const members = entry.members.filter((m) => m !== leaving);
      // Two unresolvable senders are two senders: null never matches null.
      const senderStillListed =
        leaving.senderName !== null && members.some((m) => m.senderName === leaving.senderName);
      return [
        {
          ...entry,
          members,
          // The list's own token may be the one leaving; any other works.
          token: entry.token === leaving.token ? (members[0]?.token ?? entry.token) : entry.token,
          ...(typeof entry.senderCount === 'number'
            ? { senderCount: entry.senderCount - (senderStillListed ? 0 : 1) }
            : {}),
          ...(typeof entry.affectedCount === 'number'
            ? { affectedCount: entry.affectedCount - leaving.affectedCount }
            : {}),
        },
      ];
    });

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
    // Never a loading state. `isLoading` is true only while the FIRST
    // fetch of a scope is in flight, and everything that fetch returns
    // is exactly what the baseline above swallows — so forwarding it
    // flashes an empty "Loading…" tray on every boot and mailbox
    // switch, announcing an undo that is never going to arrive.
    isLoading: false,
    isError: entriesQuery.isError,
    error: entriesQuery.error ?? null,
    revert: (token) => revertToken(token),
    revertMember: (token) => revertToken(token, 'member'),
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
