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
 * Transition semantics (each fires ONCE — a ref guards against the 3s
 * poll re-observing the same state, per the `useMailboxSyncToasts`
 * precedent):
 *
 *   - `sync_started`: the FIRST in-progress observation
 *     (`queued`/`syncing`) for this mount. A mailbox already `ready`
 *     on mount fires nothing — no sync was observed.
 *   - `sync_completed`: a transition INTO `ready` or `failed` AFTER an
 *     observed start — never an unpaired completion (a mailbox first
 *     seen already terminal stays silent). A transient `failed` that
 *     recovers to `ready` (see `syncRefetchInterval`) emits a second
 *     completion with `outcome: 'success'` — both observations are
 *     real; analysis takes the mailbox's last outcome.
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
    }
  }, [status, mailboxId]);
}
