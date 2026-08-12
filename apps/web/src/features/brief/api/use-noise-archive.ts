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
 * acted rows Done without recomputing the payload or the counts — the
 * server keeps returning the same 8am row all day, and pretending
 * otherwise would be a fabricated number.
 *
 * Those Done marks and the receipt are DERIVED from a server read, never
 * stored: see `undoState` below for why an undo taken in the global tray
 * has to be able to reach them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@declutrmail/shared';

import { activityKeys } from '@/features/activity/api/query-keys';
import { useOptionalAuth } from '@/features/auth/auth-provider';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { undoKeys } from '@/features/undo/query-keys';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import { getActionStatus, isTerminalStatus } from '@/lib/api/actions';
import { apiErrorCode, ApiError } from '@/lib/api/client';
import type { BriefNoiseSenderWire, BriefSenderGroupWire } from '@/lib/api/brief';
import {
  useActionStatus,
  useBatchStatus,
  useBulkActionPreview,
  useCompositePreview,
  useEnqueueBulkAction,
  useEnqueueComposite,
} from '@/lib/api/use-action';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';

// NOTE: no `bulk_action_taken` fires from this surface yet. It carries a
// CLOSED `source` union in
// `packages/shared/src/observability/events.ts` with no Brief member, and
// reusing another surface's value would file this action under a screen
// the user was not on. The one-line union addition belongs to whoever
// owns that contract; a mislabelled event is worse than a missing one
// (CLAUDE.md §10 — no fake analytics). `action_overdue` (2026-08-12
// incident class) does fire here — it carries no surface/source field.

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
  /** `CurrentMailboxGuard` 409'd — the mailbox scope moved under the sheet. */
  | 'scope-conflict'
  | {
      /** Live inbox total across the selected senders. EXCLUDES protected. */
      totalMessages: number;
      /** Per-sender live counts, keyed by `senders.id`. */
      countBySenderId: ReadonlyMap<string, number>;
      /**
       * Senders the SERVER reports Protected right now. Normally empty —
       * they are filtered before the preview is even requested — but
       * protection can flip between the Brief read and this preview, and
       * the enqueue would then skip them. Carried so the sheet can label
       * those rows instead of showing a per-sender list that does not sum
       * to the headline above it.
       */
      protectedSenderIds: ReadonlySet<string>;
    };

/**
 * Undo affordance for a completed archive. D211 lists "Undo expired" as
 * its own state, so the receipt must not promise undo forever.
 * `checking` covers the window before the undo read resolves — the
 * receipt says nothing about undo rather than guessing.
 */
export type NoiseUndoState = 'checking' | 'available' | 'expired' | 'unavailable';

/**
 * What the last archive attempt did. EVERY terminal branch produces one,
 * including the failures: a toast disappears in 3.6s, and a bar that
 * reverts to its neutral invite re-arms senders that already archived —
 * inviting a second confirm that spends another cleanup unit to move
 * nothing.
 */
export type NoiseArchiveOutcome =
  | {
      kind: 'archived';
      senderCount: number;
      /** `affected_count` reported by the worker, not a client estimate. */
      affectedCount: number;
      undo: NoiseUndoState;
    }
  | { kind: 'reverted'; senderCount: number }
  /**
   * Some siblings archived, some failed. The aggregate cannot say WHICH,
   * so no row is marked Done — a wrong ✓ is worse than an absent one —
   * and the selection is cleared so the user cannot blind-retry the ones
   * that already moved.
   */
  | { kind: 'partial'; doneCount: number; failedCount: number; total: number }
  /** Every sibling failed. Nothing moved, so retrying is safe. */
  | { kind: 'failed' }
  /** The status read failed. The outcome is genuinely unknown. */
  | { kind: 'unconfirmed' };

/**
 * D226 overdue release — how long the polled archive handle may stay
 * non-terminal before it parks. 2026-08-12 incident: a destructive
 * action hung >8 min server-side and every single-slot latch polling
 * `useActionStatus`/`useBatchStatus` bricked silently — the poll has no
 * time cap and only a terminal status released it. At this deadline the
 * handle parks: the overdue toast fires and the parked poll keeps
 * running (settle/failure side effects still land). Unlike the sibling
 * screens, `busy` deliberately KEEPS covering the parked handle — this
 * whole section is one bulk entry point over the very senders the
 * parked archive may still be moving, so "released but refusing every
 * confirm" would just assert idle mid-archive and open previews whose
 * confirm is always dead. The park's value here is the honest toast +
 * terminal side effects that survive past the deadline; `busy` frees
 * when the parked handle reaches a terminal state, which the parked
 * poll guarantees is no longer "never".
 */
export const ACTION_OVERDUE_MS = 120_000;

/** Guard 4xx codes that mean "your mailbox scope moved", not "this failed". */
const SCOPE_CONFLICT_CODES = new Set(['SELECT_MAILBOX', 'NO_ACTIVE_MAILBOX', 'MAILBOX_NOT_OWNED']);

function isScopeConflict(err: unknown): boolean {
  const code = apiErrorCode(err);
  return code !== null && SCOPE_CONFLICT_CODES.has(code);
}

export function useNoiseArchive(targets: readonly NoiseTarget[]) {
  const qc = useQueryClient();
  const auth = useOptionalAuth();
  const activeMailboxId = auth?.me.activeMailboxId ?? null;

  const selectableKeys = useMemo(
    () => targets.filter((t) => blockedReason(t) === null).map((t) => t.senderKey),
    [targets],
  );

  // D65 — "default-all checked", applied to senders we have not seen
  // before rather than to the whole list on every change.
  //
  // Keyed on the joined signature, not the array identity, so a refetch
  // returning an EQUAL list does not re-check boxes the user cleared.
  // (Sender keys are sha256 hex, so the separator cannot appear in one.)
  // When the list genuinely CHANGES — a sender becomes Protected, say —
  // deselections are still preserved for the senders that survive, and
  // only the newly-selectable ones arrive checked. Resetting wholesale
  // put a cleared sender back in the selection while the CTA count
  // happened to stay the same, silently swapping WHICH sender was armed.
  const selectableSignature = selectableKeys.join('|');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(selectableKeys));
  const seenSelectableRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const next = selectableSignature === '' ? [] : selectableSignature.split('|');
    const seen = seenSelectableRef.current;
    seenSelectableRef.current = new Set(next);
    setSelected((prev) => {
      if (seen === null) return new Set(next);
      return new Set(next.filter((key) => !seen.has(key) || prev.has(key)));
    });
  }, [selectableSignature]);

  // The completed archive, held as the one fact the client owns: which
  // handle ran, over which senders, and what the worker moved.
  const [settled, setSettled] = useState<{
    /** `action_jobs.id` — the batch anchor row, or the single action. */
    handleId: string;
    senderKeys: string[];
    senderCount: number;
    affectedCount: number;
  } | null>(null);

  // Server-backed undo truth for that archive.
  //
  // The key deliberately sits UNDER `undoKeys.all` (`['undo', …]`) so the
  // tray's `invalidateAfterUndo`, which invalidates that prefix, refetches
  // this too. That is the ONLY channel by which a revert taken in the
  // global tray can reach this section. Everything the section renders
  // about the archive is DERIVED from this query and never stored, so an
  // undo cannot leave a stale "Archived ✓" on a row whose mail is back in
  // the inbox, and cannot leave a receipt claiming messages that returned.
  //
  // `batchId` IS the anchor `action_jobs.id`, and a cascade revert marks
  // every sibling including the anchor, so one read covers the batch.
  const undoState = useQuery({
    queryKey: [...undoKeys.all, 'brief-noise-archive', settled?.handleId ?? null] as const,
    queryFn: () => getActionStatus(settled!.handleId),
    enabled: settled !== null,
    // A read 4xx here is a designed state, never something to hammer (§8).
    retry: false,
    staleTime: 0,
  });

  const reverted = undoState.data?.undoRevertedAt != null;

  /** D69 "Done ✓" marks — empty the moment the archive is reverted. */
  const archivedKeys = useMemo<ReadonlySet<string>>(
    () => new Set(settled && !reverted ? settled.senderKeys : []),
    [settled, reverted],
  );

  /** Terminal branches that produced no undoable archive. */
  const [failureOutcome, setFailureOutcome] = useState<NoiseArchiveOutcome | null>(null);

  const outcome = useMemo<NoiseArchiveOutcome | null>(() => {
    if (failureOutcome) return failureOutcome;
    if (!settled) return null;
    if (reverted) return { kind: 'reverted', senderCount: settled.senderCount };
    const data = undoState.data;
    const undo: NoiseUndoState = !data
      ? 'checking'
      : data.undoToken === null
        ? 'unavailable'
        : data.undoExpiresAt !== null && Date.parse(data.undoExpiresAt) <= Date.now()
          ? 'expired'
          : 'available';
    return {
      kind: 'archived',
      senderCount: settled.senderCount,
      affectedCount: settled.affectedCount,
      undo,
    };
  }, [failureOutcome, settled, reverted, undoState.data]);

  /** Sender ids frozen at sheet-open so preview and confirm cannot diverge. */
  const [pending, setPending] = useState<{ senderIds: string[]; senderKeys: string[] } | null>(
    null,
  );
  /**
   * The one action in flight — a single-sender handle or a batch handle.
   *
   * `mailboxId` is the mailbox the action was enqueued against. Both
   * status endpoints are mailbox-scoped, so a switch mid-flight makes the
   * very next poll 404 under the NEW mailbox. That 404 says nothing about
   * the archive, which is running perfectly in the old one — so it must
   * never toast a failure or reach Sentry.
   */
  const [inFlight, setInFlight] = useState<
    | { kind: 'single'; actionId: string; senderKeys: string[]; mailboxId: string | null }
    | { kind: 'batch'; batchId: string; senderKeys: string[]; mailboxId: string | null }
    | null
  >(null);
  /**
   * Overdue parking slot (ACTION_OVERDUE_MS, 2026-08-12 incident). A
   * handle that stays non-terminal past the deadline moves here; the
   * parked poll keeps running and the terminal side effects (settle,
   * failure outcomes, invalidations) still land. `busy` keeps covering
   * this slot (see the ACTION_OVERDUE_MS doc), which also means a
   * second archive can never start — so a parked handle can never be
   * displaced here.
   */
  const [overdueInFlight, setOverdueInFlight] = useState<typeof inFlight>(null);

  // Overdue-parking timer. Cleanup cancels the deadline whenever the
  // handle clears normally, so only a genuinely stuck handle parks.
  useEffect(() => {
    if (!inFlight) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: inFlight.kind, verb: 'archive' });
      toast(
        'The Noise archive is taking longer than usual — it keeps running and will appear in Activity when it finishes.',
        'info',
      );
      setOverdueInFlight(inFlight);
      setInFlight(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(t);
  }, [inFlight]);

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
  const previewScopeConflict = previewError && isScopeConflict(previewErrorValue);
  useEffect(() => {
    if (!previewError || !pending) return;
    // A mandatory-preview failure must be observable, not just a disabled
    // button (same rule the Triage batch sheet follows) — EXCEPT for the
    // guard's own 4xx. `CurrentMailboxGuard` answering SELECT_MAILBOX is a
    // designed state, not a defect, and filing one Sentry event per
    // attempt would bury the real preview failures under it.
    if (isScopeConflict(previewErrorValue)) return;
    captureFeatureException(previewErrorValue, { surface: 'brief', reason: 'noise_bulk_preview' });
  }, [previewError, previewErrorValue, pending]);

  const preview: NoiseArchivePreview = useMemo(() => {
    if (!pending) return 'loading';
    // A scope conflict is not a failed read to retry — retrying 409s
    // forever. It gets its own state so the sheet can say what actually
    // happened and point at the way out.
    if (previewScopeConflict) return 'scope-conflict';
    if (singleId) {
      if (composite.isError) return 'unavailable';
      if (!composite.data || composite.isFetching) return 'loading';
      const isProtected = composite.data.protected;
      return {
        // A protected sender is one the enqueue will refuse, so it
        // contributes nothing to what this confirm can move.
        totalMessages: isProtected ? 0 : composite.data.counts.all,
        countBySenderId: new Map([[singleId, composite.data.counts.all]]),
        protectedSenderIds: new Set(isProtected ? [singleId] : []),
      };
    }
    if (bulk.isError) return 'unavailable';
    if (!bulk.data || bulk.isFetching) return 'loading';
    return {
      // `totals` already excludes protected senders server-side, which is
      // exactly why the per-sender rows need their protected flag: without
      // it the visible rows do not sum to this headline.
      totalMessages: bulk.data.totals.all,
      countBySenderId: new Map(bulk.data.senders.map((s) => [s.senderId, s.counts.all] as const)),
      protectedSenderIds: new Set(
        bulk.data.senders.filter((s) => s.protected).map((s) => s.senderId),
      ),
    };
  }, [
    pending,
    previewScopeConflict,
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
    // Read the CODE, never the bare status. `CurrentMailboxGuard` sits in
    // front of this endpoint and also answers 409 (NO_ACTIVE_MAILBOX /
    // SELECT_MAILBOX / MAILBOX_NOT_OWNED), as does an idempotency-key
    // conflict. Branching on 409 alone told a user with no active mailbox
    // that their SENDER was Protected — an assertion this handler never
    // read. See the docblock on `apps/web/src/lib/api/client.ts`.
    if (apiErrorCode(err) === 'PROTECTED_SENDER') {
      toast(
        'Those senders are Protected now, so nothing was archived. Unprotect them to include them.',
        'warn',
      );
      return;
    }
    if (isScopeConflict(err)) {
      // The guard moved the scope out from under the confirm. Designed
      // state — the app shell owns the recovery (picker / reconnect).
      toast('Your active mailbox changed, so nothing was archived.', 'warn');
      return;
    }
    // EVERY other failure — including the remaining 409s — is a real
    // defect signal and keeps its Sentry event.
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
    // The D226 gate lives HERE, not only in the sheet's `disabled` prop.
    // "No mutation without a resolved, non-zero live count" is a rule
    // about the mutation, and a rule that exists only in a disabled
    // attribute is one refactor or one second caller away from being
    // gone. Clearing `pending` first also makes a double-invoke
    // (⌘⏎ racing the click) a no-op at the guard above.
    if (typeof preview !== 'object' || preview.totalMessages === 0) return;
    // 2026-08-12 incident amendment: a parked (overdue) handle still
    // OWNS its senders, and `busy` keeps the section covered while one
    // exists — so this branch is normally unreachable from the UI. It
    // stays as the mutation-level rule (same D226 reasoning as the gate
    // above): re-archiving while the parked archive may still be moving
    // these senders would mint a second real Gmail job under a fresh
    // idempotency key. The sheet stays open — the confirmed intent
    // survives for a retry once the parked handle terminates.
    if (overdueInFlight !== null) {
      toast('The earlier archive is still running — give it a moment.', 'info');
      return;
    }
    const { senderIds, senderKeys } = pending;
    setPending(null);
    setFailureOutcome(null);
    const primary = { type: 'archive' as const, olderThanDays: null };

    if (senderIds.length === 1) {
      enqueueComposite.mutate(
        { senderId: senderIds[0]!, primary },
        {
          onSuccess: (res) => {
            setInFlight({
              kind: 'single',
              actionId: res.actionId,
              senderKeys,
              mailboxId: activeMailboxId,
            });
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
          // EVERY skip is surfaced, not just the protected ones. A
          // `not_found` skip — what a deleted sender or a mid-flow
          // mailbox switch produces — used to vanish in silence: the
          // preview counted the sender, the batch dropped it, and nothing
          // on screen said so. The section's contract is that an
          // exclusion is always visible.
          const protectedCount = res.skipped.filter((s) => s.reason === 'protected').length;
          const missingCount = res.skipped.length - protectedCount;
          const parts: string[] = [];
          if (protectedCount > 0) {
            parts.push(`${protectedCount} Protected`);
          }
          if (missingCount > 0) {
            parts.push(`${missingCount} no longer in this mailbox`);
          }
          if (parts.length > 0) {
            toast(
              `${parts.join(' and ')} — left out of this archive. ${res.senderCount} sender${
                res.senderCount === 1 ? '' : 's'
              } went ahead.`,
              'warn',
            );
          }
          setInFlight({
            kind: 'batch',
            batchId: res.batchId,
            senderKeys: enqueuedKeys,
            mailboxId: activeMailboxId,
          });
        },
        onError: (err) => onEnqueueError(err, senderIds.length),
      },
    );
  }, [
    pending,
    preview,
    overdueInFlight,
    activeMailboxId,
    enqueueComposite,
    enqueueBulk,
    onEnqueueError,
  ]);

  // ── Terminal handling (server confirmation only, D226) ────────────
  const singleStatus = useActionStatus(inFlight?.kind === 'single' ? inFlight.actionId : null);
  const batchStatus = useBatchStatus(inFlight?.kind === 'batch' ? inFlight.batchId : null);
  const overdueSingleStatus = useActionStatus(
    overdueInFlight?.kind === 'single' ? overdueInFlight.actionId : null,
  );
  const overdueBatchStatus = useBatchStatus(
    overdueInFlight?.kind === 'batch' ? overdueInFlight.batchId : null,
  );

  /**
   * Mail moved, so Activity and the sender counts are both stale. The
   * Brief itself is NOT invalidated — D69 keeps returning the same frozen
   * row, so refetching it would cost a request and change nothing.
   *
   * Called on the partial branch too: that branch is only reachable when
   * mail actually moved (`getBatchStatus` reports `failed` only when every
   * sibling failed, so `done` with `failed > 0` guarantees `done > 0`),
   * and its own copy tells the user to check Activity.
   */
  const invalidateMovedMail = useCallback(() => {
    void qc.invalidateQueries({ queryKey: activityKeys.all });
    void qc.invalidateQueries({ queryKey: sendersKeys.all });
  }, [qc]);

  // Each caller clears its OWN slot (active `inFlight` or the parked
  // `overdueInFlight`) — if settle cleared `inFlight` itself, a parked
  // handle settling late would kill the tracking of a NEWER action the
  // released latch has since accepted.
  const settle = useCallback(
    (handleId: string, keys: string[], result: { senderCount: number; affectedCount: number }) => {
      setSettled({ handleId, senderKeys: keys, ...result });
      setFailureOutcome(null);
      invalidateMovedMail();
    },
    [invalidateMovedMail],
  );

  /**
   * Clear the selection after a terminal state whose per-sender outcome we
   * cannot resolve. Leaving the boxes checked re-arms senders that already
   * archived, and re-confirming spends another cleanup unit to move mail
   * that has already moved.
   */
  const clearSelection = useCallback((keys: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, []);

  /**
   * True when the poll failed only because the mailbox scope moved after
   * the action was enqueued. Both status routes are mailbox-scoped, so the
   * first poll after a switch 404s under the NEW mailbox while the archive
   * runs perfectly in the old one. Reporting that as a failure put a
   * "couldn't confirm the archive" toast over an unrelated mailbox's Brief
   * and filed a Sentry event for a healthy action.
   */
  const scopeMoved = inFlight !== null && inFlight.mailboxId !== activeMailboxId;

  useEffect(() => {
    if (inFlight?.kind !== 'single') return;
    if (singleStatus.isError) {
      if (scopeMoved || isScopeConflict(singleStatus.error)) {
        setInFlight(null);
        return;
      }
      captureFeatureException(singleStatus.error, {
        surface: 'brief',
        reason: 'noise_archive_status',
      });
      toast(getActionFailureCopy('status', { action: 'the Noise archive' }).message, 'warn');
      clearSelection(inFlight.senderKeys);
      setFailureOutcome({ kind: 'unconfirmed' });
      setInFlight(null);
      return;
    }
    const data = singleStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      settle(inFlight.actionId, inFlight.senderKeys, {
        senderCount: 1,
        affectedCount: data.affectedCount,
      });
      setInFlight(null);
      return;
    }
    toast(getActionFailureCopy('terminal', { action: 'the Noise archive' }).message, 'warn');
    // Nothing moved, so the senders stay checked and a retry is safe.
    setFailureOutcome({ kind: 'failed' });
    setInFlight(null);
  }, [
    inFlight,
    scopeMoved,
    singleStatus.data,
    singleStatus.isError,
    singleStatus.error,
    settle,
    clearSelection,
  ]);

  useEffect(() => {
    if (inFlight?.kind !== 'batch') return;
    if (batchStatus.isError) {
      if (scopeMoved || isScopeConflict(batchStatus.error)) {
        setInFlight(null);
        return;
      }
      captureFeatureException(batchStatus.error, {
        surface: 'brief',
        reason: 'noise_archive_batch_status',
      });
      toast(getActionFailureCopy('status', { action: 'the Noise archive' }).message, 'warn');
      clearSelection(inFlight.senderKeys);
      setFailureOutcome({ kind: 'unconfirmed' });
      setInFlight(null);
      return;
    }
    const data = batchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'failed') {
      toast(getActionFailureCopy('terminal', { action: 'the Noise archive' }).message, 'warn');
      setFailureOutcome({ kind: 'failed' });
      setInFlight(null);
      return;
    }
    // A partial failure keeps `status: 'done'` and surfaces via
    // `failed > 0`. The aggregate cannot say WHICH siblings failed, so no
    // row is marked Done — a wrong ✓ is worse than an absent one — and the
    // selection is cleared so the user cannot blind-retry the ones that
    // already archived.
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
      clearSelection(inFlight.senderKeys);
      setFailureOutcome({
        kind: 'partial',
        doneCount: data.done,
        failedCount: data.failed,
        total: data.total,
      });
      setInFlight(null);
      invalidateMovedMail();
      return;
    }
    settle(inFlight.batchId, inFlight.senderKeys, {
      senderCount: data.done,
      affectedCount: data.affectedCount,
    });
    setInFlight(null);
  }, [
    inFlight,
    scopeMoved,
    batchStatus.data,
    batchStatus.isError,
    batchStatus.error,
    settle,
    clearSelection,
    invalidateMovedMail,
  ]);

  /** Parked twin of `scopeMoved` — same 404-after-switch honesty rule. */
  const overdueScopeMoved =
    overdueInFlight !== null && overdueInFlight.mailboxId !== activeMailboxId;

  // Overdue mirrors of the two effects above (ACTION_OVERDUE_MS): the
  // parked handle runs the SAME terminal side effects — settle with its
  // Done marks and receipt, failure outcomes, selection clears,
  // invalidations, failure toasts — and frees the parked slot. Nothing
  // here toasts success (the active path never did either).
  useEffect(() => {
    if (overdueInFlight?.kind !== 'single') return;
    if (overdueSingleStatus.isError) {
      if (overdueScopeMoved || isScopeConflict(overdueSingleStatus.error)) {
        setOverdueInFlight(null);
        return;
      }
      captureFeatureException(overdueSingleStatus.error, {
        surface: 'brief',
        reason: 'noise_archive_status',
      });
      toast(getActionFailureCopy('status', { action: 'the Noise archive' }).message, 'warn');
      clearSelection(overdueInFlight.senderKeys);
      setFailureOutcome({ kind: 'unconfirmed' });
      setOverdueInFlight(null);
      return;
    }
    const data = overdueSingleStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation just changed what the next preview
    // describes: both preview caches must re-count before any confirm.
    void qc.invalidateQueries({ queryKey: ['composite-preview'] });
    void qc.invalidateQueries({ queryKey: ['bulk-action-preview'] });
    if (data.status === 'done') {
      settle(overdueInFlight.actionId, overdueInFlight.senderKeys, {
        senderCount: 1,
        affectedCount: data.affectedCount,
      });
      setOverdueInFlight(null);
      return;
    }
    toast(getActionFailureCopy('terminal', { action: 'the Noise archive' }).message, 'warn');
    setFailureOutcome({ kind: 'failed' });
    setOverdueInFlight(null);
  }, [
    overdueInFlight,
    overdueScopeMoved,
    overdueSingleStatus.data,
    overdueSingleStatus.isError,
    overdueSingleStatus.error,
    settle,
    clearSelection,
    qc,
  ]);

  useEffect(() => {
    if (overdueInFlight?.kind !== 'batch') return;
    if (overdueBatchStatus.isError) {
      if (overdueScopeMoved || isScopeConflict(overdueBatchStatus.error)) {
        setOverdueInFlight(null);
        return;
      }
      captureFeatureException(overdueBatchStatus.error, {
        surface: 'brief',
        reason: 'noise_archive_batch_status',
      });
      toast(getActionFailureCopy('status', { action: 'the Noise archive' }).message, 'warn');
      clearSelection(overdueInFlight.senderKeys);
      setFailureOutcome({ kind: 'unconfirmed' });
      setOverdueInFlight(null);
      return;
    }
    const data = overdueBatchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation just changed what the next preview
    // describes: both preview caches must re-count before any confirm.
    void qc.invalidateQueries({ queryKey: ['composite-preview'] });
    void qc.invalidateQueries({ queryKey: ['bulk-action-preview'] });
    if (data.status === 'failed') {
      toast(getActionFailureCopy('terminal', { action: 'the Noise archive' }).message, 'warn');
      setFailureOutcome({ kind: 'failed' });
      setOverdueInFlight(null);
      return;
    }
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
      clearSelection(overdueInFlight.senderKeys);
      setFailureOutcome({
        kind: 'partial',
        doneCount: data.done,
        failedCount: data.failed,
        total: data.total,
      });
      setOverdueInFlight(null);
      invalidateMovedMail();
      return;
    }
    settle(overdueInFlight.batchId, overdueInFlight.senderKeys, {
      senderCount: data.done,
      affectedCount: data.affectedCount,
    });
    setOverdueInFlight(null);
  }, [
    overdueInFlight,
    overdueScopeMoved,
    overdueBatchStatus.data,
    overdueBatchStatus.isError,
    overdueBatchStatus.error,
    settle,
    clearSelection,
    invalidateMovedMail,
    qc,
  ]);

  return {
    selected,
    toggle,
    selectedTargets,
    archivedKeys,
    outcome,
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
    /**
     * True from confirm until the worker reaches a terminal state —
     * INCLUDING while the handle is parked overdue (see the
     * ACTION_OVERDUE_MS doc): this section is one bulk entry point over
     * the very senders a parked archive may still be moving, so it must
     * never assert idle mid-archive.
     */
    busy:
      inFlight !== null ||
      overdueInFlight !== null ||
      enqueueComposite.isPending ||
      enqueueBulk.isPending,
  };
}
