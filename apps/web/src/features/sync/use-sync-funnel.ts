'use client';

import { useEffect, useRef } from 'react';
import type { SyncReadiness, SyncStatus } from '@declutrmail/shared/contracts';

import { track } from '@/lib/posthog';

/**
 * D159 sync-gate funnel emitter — fires `sync_started` /
 * `sync_completed` from the FE's observation of the D224 status poll
 * (`useSyncStatus`). Both call sites are initial-sync gates (the
 * onboarding gate + the D116 secondary-connect gate), so `trigger` is
 * always `'initial'`.
 *
 * Transition semantics (each fires ONCE per started/completed pair — a
 * ref guards against the 3s poll re-observing the same state, per the
 * `useMailboxSyncToasts` precedent):
 *
 *   - `sync_started`: the FIRST in-progress observation
 *     (`queued`/`syncing`) since mount or since the last completion. A
 *     mailbox already `ready` on mount fires nothing — no sync was
 *     observed.
 *   - `sync_completed`: a transition INTO `ready` or `failed` AFTER an
 *     observed start — never an unpaired completion (a mailbox first
 *     seen already terminal stays silent). Each completion CLOSES its
 *     pair, so a transient `failed` that recovers (see
 *     `syncRefetchInterval`) emits a fresh pair once `queued`/`syncing`
 *     is re-observed, with `duration_ms` clocked from the SECOND start
 *     — not inflated across the failed period + retry gap. A `failed` →
 *     `ready` flip with no in-progress observation in between stays
 *     silent: there is no new start to pair the recovery with.
 *
 * Payload honesty (CLAUDE.md §10 — no fake events): the status poll
 * carries no sync id or message counts, so `sync_id` is `null` and
 * `messages_indexed` is -1 by the taxonomy's conventions; `duration_ms`
 * is the observed wait (first in-progress poll → terminal), not the
 * server-side sync duration.
 */
export function useSyncGateFunnel(status: SyncStatus | undefined, mailboxId: string | null): void {
  const lastReadiness = useRef<SyncReadiness | null>(null);
  const observedStartAt = useRef<number | null>(null);

  useEffect(() => {
    if (!status || mailboxId == null) return;
    const readiness = status.readiness_status;
    const prev = lastReadiness.current;
    if (readiness === prev) return; // poll re-fire — same state, no event
    lastReadiness.current = readiness;

    const inProgress = readiness === 'queued' || readiness === 'syncing';
    if (inProgress && observedStartAt.current == null) {
      observedStartAt.current = Date.now();
      void track('sync_started', { sync_id: null, mailbox_id: mailboxId, trigger: 'initial' });
      return;
    }

    if (observedStartAt.current != null && (readiness === 'ready' || readiness === 'failed')) {
      void track('sync_completed', {
        sync_id: null,
        mailbox_id: mailboxId,
        messages_indexed: -1,
        duration_ms: Date.now() - observedStartAt.current,
        outcome: readiness === 'ready' ? 'success' : 'failed',
      });
      // Close the pair. Without this, a failed → syncing → ready
      // recovery within one mount drops its second sync_started and
      // clocks the second completion from the ORIGINAL start.
      observedStartAt.current = null;
    }
  }, [status, mailboxId]);
}
