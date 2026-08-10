'use client';

/**
 * `useNoiseArchive` — the D65 Noise bulk-archive interaction (D198:
 * behavior in a headless hook, rendering owned by the feature).
 *
 * Lifecycle is D226's, unchanged and unforked:
 *
 *   selection → sheet → PREVIEW (mandatory) → mutation → undo
 *
 * Nothing here is new machinery. Selection drives the SAME
 * `POST /api/actions` the Senders and Triage bulk flows use (ADR-0020),
 * previewed by the same `/preview` + `/preview/bulk` endpoints, polled by
 * the same status hooks, and undone by the same cascade token the global
 * `ProductUndoTray` already lists — this surface never touches undo
 * directly.
 *
 * SCOPE, stated once so every reader of this file knows it: the archive
 * enqueued here targets each selected sender's mail that is IN THE INBOX
 * NOW, resolved by the worker at execution. It is NOT limited to the
 * message ids the 8am snapshot froze. The shipped action wire addresses
 * senders, not frozen message-id sets (the `messages` selector was
 * removed from the request schema on 2026-07-27), so a yesterday-only
 * archive is not expressible today. Every piece of copy on this surface
 * therefore names the wider scope, and the mandatory preview states the
 * real live count before anything moves.
 *
 * D245: Protected senders are excluded from bulk mail-changing actions.
 * They are filtered out of the request here, shown as excluded in the UI,
 * and — if protection flips between the read and the confirm — dropped
 * again server-side, which this hook honours by only marking the senders
 * the server actually enqueued.
 *
 * D69: the Brief is a frozen snapshot. A completed archive marks the
 * acted rows Done here in client state; it never recomputes the payload
 * or the counts, because the server will keep returning the same 8am row
 * all day and pretending otherwise would be a fabricated number.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { toast } from '@declutrmail/shared';

import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import { isTerminalStatus } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';
import type { BriefNoiseSenderWire, BriefSenderGroupWire } from '@/lib/api/brief';
import {
  useActionStatus,
  useBatchStatus,
  useBulkActionPreview,
  useCompositePreview,
  useEnqueueBulkAction,
  useEnqueueComposite,
} from '@/lib/api/use-action';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';

// NOTE: no PostHog event fires from this surface yet. `bulk_action_taken`
// carries a CLOSED `source` union in
// `packages/shared/src/observability/events.ts` with no Brief member, and
// reusing another surface's value would file this action under a screen
// the user was not on. The one-line union addition belongs to whoever
// owns that contract; a mislabelled event is worse than a missing one
// (CLAUDE.md §10 — no fake analytics).

/** One Noise row joined to its live archive target. */
export interface NoiseTarget {
  senderKey: string;
  senderName: string;
  /** Frozen yesterday count (D69). Display only — never the action's scope. */
  messageCount: number;
  /** `senders.id`; null when the sender row no longer exists. */
  senderId: string | null;
  /** D245 — Protected senders are excluded from bulk actions. */
  isProtected: boolean;
}

/** Why a row cannot be selected, or `null` when it can. */
export type NoiseBlockedReason = 'protected' | 'unresolved';

export function blockedReason(target: NoiseTarget): NoiseBlockedReason | null {
  if (target.isProtected) return 'protected';
  if (target.senderId === null) return 'unresolved';
  return null;
}

/**
 * Join the frozen Noise groups to their read-time archive targets. Pure
 * so the join is unit-testable without a render.
 *
 * A group with no matching `noiseSenders` entry — an API that predates
 * D65, or a sender deleted since the snapshot — resolves to
 * `senderId: null` and is rendered unactionable. It is never dropped
 * from the list: the Brief said this sender mailed you yesterday, and
 * that stays true whether or not we can act on it.
 */
export function buildNoiseTargets(
  groups: readonly BriefSenderGroupWire[],
  noiseSenders: readonly BriefNoiseSenderWire[],
): NoiseTarget[] {
  const byKey = new Map(noiseSenders.map((s) => [s.senderKey, s] as const));
  return groups.map((group) => {
    const resolved = byKey.get(group.senderKey);
    return {
      senderKey: group.senderKey,
      senderName: group.senderName,
      messageCount: group.messageCount,
      senderId: resolved?.senderId ?? null,
      isProtected: resolved?.isProtected ?? false,
    };
  });
}

/**
 * Normalized preview for the sheet. `'loading'` and `'unavailable'` both
 * block confirm — D226 permits no mutation without a live count.
 */
export type NoiseArchivePreview =
  | 'loading'
  | 'unavailable'
  | {
      /** Live inbox total across the selected senders. */
      totalMessages: number;
      /** Per-sender live counts, keyed by `senders.id`. */
      countBySenderId: ReadonlyMap<string, number>;
    };

/** Terminal receipt for a completed archive — real server figures only. */
export interface NoiseArchiveReceipt {
  senderCount: number;
  /** `affected_count` reported by the worker, not a client estimate. */
  affectedCount: number;
  /** Senders whose job failed; they are NOT marked Done. */
  failedCount: number;
}

export function useNoiseArchive(targets: readonly NoiseTarget[]) {
  const qc = useQueryClient();

  const selectableKeys = useMemo(
    () => targets.filter((t) => blockedReason(t) === null).map((t) => t.senderKey),
    [targets],
  );

  // D65 — "default-all checked". Re-derived whenever the selectable set
  // changes identity so a fresh Brief opens fully checked.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(selectableKeys));
  const selectableSignature = selectableKeys.join('|');
  useEffect(() => {
    setSelected(new Set(selectableKeys));
    // `selectableKeys` is rebuilt on every render of a new array
    // identity; the joined signature is the value that actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableSignature]);

  // Senders whose archive the server confirmed — D69's "Done ✓" marks.
  const [archivedKeys, setArchivedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [receipt, setReceipt] = useState<NoiseArchiveReceipt | null>(null);

  /** Sender ids frozen at sheet-open so preview and confirm cannot diverge. */
  const [pending, setPending] = useState<{ senderIds: string[]; senderKeys: string[] } | null>(
    null,
  );
  /** The one action in flight — a single-sender handle or a batch handle. */
  const [inFlight, setInFlight] = useState<
    | { kind: 'single'; actionId: string; senderKeys: string[] }
    | { kind: 'batch'; batchId: string; senderKeys: string[] }
    | null
  >(null);

  const toggle = useCallback((senderKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(senderKey)) next.delete(senderKey);
      else next.add(senderKey);
      return next;
    });
  }, []);

  const selectedTargets = useMemo(
    () =>
      targets.filter(
        (t) =>
          selected.has(t.senderKey) && blockedReason(t) === null && !archivedKeys.has(t.senderKey),
      ),
    [targets, selected, archivedKeys],
  );

  // ── Mandatory preview (D226) ──────────────────────────────────────
  //
  // The bulk endpoint requires ≥2 senders; one sender uses the composite
  // endpoint. Same guarantee either way — a REAL server count, and no
  // confirm until it lands.
  const singleId = pending && pending.senderIds.length === 1 ? pending.senderIds[0]! : null;
  const bulkIds = pending && pending.senderIds.length > 1 ? pending.senderIds : null;
  const composite = useCompositePreview(singleId);
  const bulk = useBulkActionPreview(bulkIds);

  const previewError = singleId ? composite.isError : bulkIds ? bulk.isError : false;
  const previewErrorValue = singleId ? composite.error : bulk.error;
  useEffect(() => {
    if (!previewError || !pending) return;
    // A mandatory-preview failure must be observable, not just a
    // disabled button (same rule the Triage batch sheet follows).
    captureFeatureException(previewErrorValue, { surface: 'brief', reason: 'noise_bulk_preview' });
  }, [previewError, previewErrorValue, pending]);

  const preview: NoiseArchivePreview = useMemo(() => {
    if (!pending) return 'loading';
    if (singleId) {
      if (composite.isError) return 'unavailable';
      if (!composite.data || composite.isFetching) return 'loading';
      return {
        totalMessages: composite.data.counts.all,
        countBySenderId: new Map([[singleId, composite.data.counts.all]]),
      };
    }
    if (bulk.isError) return 'unavailable';
    if (!bulk.data || bulk.isFetching) return 'loading';
    return {
      totalMessages: bulk.data.totals.all,
      countBySenderId: new Map(bulk.data.senders.map((s) => [s.senderId, s.counts.all] as const)),
    };
  }, [
    pending,
    singleId,
    composite.isError,
    composite.data,
    composite.isFetching,
    bulk.isError,
    bulk.data,
    bulk.isFetching,
  ]);

  const openSheet = useCallback(() => {
    if (selectedTargets.length === 0) return;
    setReceipt(null);
    setPending({
      senderIds: selectedTargets.map((t) => t.senderId!),
      senderKeys: selectedTargets.map((t) => t.senderKey),
    });
    addBreadcrumb({
      category: 'action',
      message: 'brief: noise archive preview opened',
      level: 'info',
      data: { sender_count: selectedTargets.length },
    });
  }, [selectedTargets]);

  const closeSheet = useCallback(() => setPending(null), []);

  const retryPreview = useCallback(() => {
    if (singleId) void composite.refetch();
    else void bulk.refetch();
  }, [singleId, composite, bulk]);

  const enqueueComposite = useEnqueueComposite();
  const enqueueBulk = useEnqueueBulkAction();

  const onEnqueueError = useCallback((err: unknown, senderCount: number) => {
    setPending(null);
    // 402 is the entitlement cap — the global UpgradeModal already
    // explains it, so neither Sentry nor a second toast helps.
    if (err instanceof ApiError && err.status === 402) return;
    if (err instanceof ApiError && err.status === 409) {
      toast(
        'Those senders are Protected now, so nothing was archived. Unprotect them to include them.',
        'warn',
      );
      return;
    }
    captureFeatureException(err, { surface: 'brief', reason: 'noise_bulk_enqueue' });
    toast(
      getActionFailureCopy('enqueue', {
        action: `archive ${senderCount === 1 ? 'that sender' : `those ${senderCount} senders`}`,
      }).message,
      'warn',
    );
  }, []);

  const confirm = useCallback(() => {
    if (!pending) return;
    const { senderIds, senderKeys } = pending;
    setPending(null);
    const primary = { type: 'archive' as const, olderThanDays: null };

    if (senderIds.length === 1) {
      enqueueComposite.mutate(
        { senderId: senderIds[0]!, primary },
        {
          onSuccess: (res) => {
            setInFlight({ kind: 'single', actionId: res.actionId, senderKeys });
          },
          onError: (err) => onEnqueueError(err, 1),
        },
      );
      return;
    }

    enqueueBulk.mutate(
      { senderIds, primary },
      {
        onSuccess: (res) => {
          // Only senders the server actually enqueued may ever be marked
          // Done. `skipped` carries the ones it refused — protection can
          // flip between the read that built this list and this confirm.
          const skipped = new Set(res.skipped.map((s) => s.senderId));
          const enqueuedKeys = senderKeys.filter((_key, i) => !skipped.has(senderIds[i]!));
          if (res.skipped.some((s) => s.reason === 'protected')) {
            const n = res.skipped.filter((s) => s.reason === 'protected').length;
            toast(
              `${n} Protected sender${n === 1 ? ' was' : 's were'} left out of this archive.`,
              'warn',
            );
          }
          setInFlight({ kind: 'batch', batchId: res.batchId, senderKeys: enqueuedKeys });
        },
        onError: (err) => onEnqueueError(err, senderIds.length),
      },
    );
  }, [pending, enqueueComposite, enqueueBulk, onEnqueueError]);

  // ── Terminal handling (server confirmation only, D226) ────────────
  const singleStatus = useActionStatus(inFlight?.kind === 'single' ? inFlight.actionId : null);
  const batchStatus = useBatchStatus(inFlight?.kind === 'batch' ? inFlight.batchId : null);

  const settle = useCallback(
    (keys: string[], result: NoiseArchiveReceipt) => {
      setArchivedKeys((prev) => new Set([...prev, ...keys]));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const key of keys) next.delete(key);
        return next;
      });
      setReceipt(result);
      setInFlight(null);
      // The archive moved real mail: Activity and the sender counts are
      // both stale now. The Brief itself is NOT invalidated — D69 keeps
      // returning the same frozen row, so refetching it would only cost
      // a request and change nothing on screen.
      void qc.invalidateQueries({ queryKey: activityKeys.all });
      void qc.invalidateQueries({ queryKey: sendersKeys.all });
    },
    [qc],
  );

  useEffect(() => {
    if (inFlight?.kind !== 'single') return;
    if (singleStatus.isError) {
      captureFeatureException(singleStatus.error, {
        surface: 'brief',
        reason: 'noise_archive_status',
      });
      toast(getActionFailureCopy('status', { action: 'the Noise archive' }).message, 'warn');
      setInFlight(null);
      return;
    }
    const data = singleStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      settle(inFlight.senderKeys, {
        senderCount: 1,
        affectedCount: data.affectedCount,
        failedCount: 0,
      });
      return;
    }
    toast(getActionFailureCopy('terminal', { action: 'the Noise archive' }).message, 'warn');
    setInFlight(null);
  }, [inFlight, singleStatus.data, singleStatus.isError, singleStatus.error, settle]);

  useEffect(() => {
    if (inFlight?.kind !== 'batch') return;
    if (batchStatus.isError) {
      captureFeatureException(batchStatus.error, {
        surface: 'brief',
        reason: 'noise_archive_batch_status',
      });
      toast(getActionFailureCopy('status', { action: 'the Noise archive' }).message, 'warn');
      setInFlight(null);
      return;
    }
    const data = batchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'failed') {
      toast(getActionFailureCopy('terminal', { action: 'the Noise archive' }).message, 'warn');
      setInFlight(null);
      return;
    }
    // A partial failure keeps `status: 'done'` and surfaces via
    // `failed > 0`. We cannot tell WHICH siblings failed from the
    // aggregate, so no row is marked Done when any of them did — a
    // wrong ✓ on this surface is worse than an absent one.
    if (data.failed > 0) {
      toast(
        getActionFailureCopy('terminal', {
          action: 'the Noise archive',
          whatChanged: `${data.done} of ${data.total} senders were archived.`,
          whatDidNotChange: `${data.failed} did not complete.`,
          nextStep: 'Check Activity to see which senders moved, then retry the rest.',
        }).message,
        'warn',
      );
      setInFlight(null);
      return;
    }
    settle(inFlight.senderKeys, {
      senderCount: data.done,
      affectedCount: data.affectedCount,
      failedCount: 0,
    });
  }, [inFlight, batchStatus.data, batchStatus.isError, batchStatus.error, settle]);

  return {
    selected,
    toggle,
    selectedTargets,
    archivedKeys,
    receipt,
    /** Sheet is mounted while a selection is pending confirmation. */
    sheetOpen: pending !== null,
    pendingTargets: useMemo(
      () => (pending ? targets.filter((t) => pending.senderKeys.includes(t.senderKey)) : []),
      [pending, targets],
    ),
    preview,
    openSheet,
    closeSheet,
    retryPreview,
    confirm,
    /** True from confirm until the worker reaches a terminal state. */
    busy: inFlight !== null || enqueueComposite.isPending || enqueueBulk.isPending,
  };
}
