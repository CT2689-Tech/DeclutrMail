'use client';

import { useEffect, useRef } from 'react';
import type { SyncReadiness, SyncStatus } from '@declutrmail/shared/contracts';

import { observeLastSyncedAt, observeSyncReadiness } from './sync-lifecycle';

/**
 * D159 sync-lifecycle emitter — fires `sync_started` / `sync_completed`
 * from the FE's observation of the D224 status poll (`useSyncStatus`).
 *
 * Call sites: the onboarding / secondary-connect gates, and the authed
 * app shell (so a scan that finishes after the user leaves the gate is
 * still counted). `trigger` is `'initial'` for readiness transitions;
 * a later `last_synced_at` advance on an already-ready mailbox is an
 * incremental/manual completion (see `observeLastSyncedAt`).
 *
 * Transition semantics (each fires ONCE per started/completed pair —
 * sessionStorage plus an in-memory map guard the 3s poll and remounts):
 *
 *   - `sync_started`: the FIRST in-progress observation
 *     (`queued`/`syncing`) since this tab last closed a pair. A
 *     mailbox already `ready` on mount fires nothing — no sync was
 *     observed in this tab, unless an earlier mount in the same tab
 *     stored an open pair (refresh mid-scan).
 *   - `sync_completed`: a transition INTO `ready` or `failed` AFTER an
 *     observed start — never an unpaired completion from readiness
 *     alone. Each completion CLOSES its pair, so a transient `failed`
 *     that recovers emits a fresh pair once `queued`/`syncing` is
 *     re-observed, with `duration_ms` clocked from the SECOND start.
 *     A `failed` → `ready` flip with no in-progress observation in
 *     between stays silent.
 *
 * Payload honesty (CLAUDE.md §10 — no fake events): the status poll
 * carries no sync id or message counts, so `sync_id` is `null` and
 * `messages_indexed` is -1 by the taxonomy's conventions; `duration_ms`
 * is the observed wait (first in-progress poll → terminal), not the
 * server-side sync duration.
 */
export function useSyncGateFunnel(status: SyncStatus | undefined, mailboxId: string | null): void {
  const lastReadiness = useRef<SyncReadiness | null>(null);
  const lastStamp = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!status || mailboxId == null) return;
    const readiness = status.readiness_status;
    const stamp = status.last_synced_at ?? null;
    const readinessChanged = readiness !== lastReadiness.current;
    const stampChanged = stamp !== lastStamp.current;
    if (!readinessChanged && !stampChanged) return;
    lastReadiness.current = readiness;
    lastStamp.current = stamp;

    if (readinessChanged) {
      observeSyncReadiness(mailboxId, readiness, 'initial');
    }
    observeLastSyncedAt(mailboxId, stamp, readiness);
  }, [status, mailboxId]);
}
