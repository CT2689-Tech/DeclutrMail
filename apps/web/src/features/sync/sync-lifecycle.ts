/**
 * Shared D159 sync-lifecycle emitter. The onboarding gate, the in-app
 * mailbox toast observer, and the app-shell status poll all call this
 * so a real successful sync is counted once even when the user leaves
 * the gate mid-scan.
 *
 * Persistence is sessionStorage (tab lifetime, including refresh) plus
 * an in-memory map for the same JS context. A worker cannot emit these
 * events — analytics consent is per-browser (D147).
 */

import type { SyncReadiness } from '@declutrmail/shared/contracts';
import type { EventPayloads } from '@declutrmail/shared/observability';

import { track } from '@/lib/posthog';

type SyncTrigger = EventPayloads['sync_started']['trigger'];

interface OpenPair {
  startedAt: number;
  trigger: SyncTrigger;
}

const PAIR_PREFIX = 'dm.sync-funnel:';
const STAMP_PREFIX = 'dm.sync-stamp:';

const memoryPairs = new Map<string, OpenPair>();
const memoryStamps = new Map<string, string | null>();
const pendingManual = new Map<string, number>();

function pairKey(mailboxId: string): string {
  return `${PAIR_PREFIX}${mailboxId}`;
}

function stampKey(mailboxId: string): string {
  return `${STAMP_PREFIX}${mailboxId}`;
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode / quota — the in-memory map still covers this tab.
  }
}

function readPair(mailboxId: string): OpenPair | null {
  const stored = readStorage(pairKey(mailboxId));
  if (stored != null) {
    try {
      const parsed = JSON.parse(stored) as OpenPair;
      if (typeof parsed.startedAt === 'number' && typeof parsed.trigger === 'string') {
        return parsed;
      }
    } catch {
      // Fall through to memory.
    }
  }
  return memoryPairs.get(mailboxId) ?? null;
}

function writePair(mailboxId: string, pair: OpenPair | null): void {
  if (pair == null) {
    memoryPairs.delete(mailboxId);
    writeStorage(pairKey(mailboxId), null);
    return;
  }
  memoryPairs.set(mailboxId, pair);
  writeStorage(pairKey(mailboxId), JSON.stringify(pair));
}

function readStamp(mailboxId: string): { seen: boolean; value: string | null } {
  if (memoryStamps.has(mailboxId)) {
    return { seen: true, value: memoryStamps.get(mailboxId) ?? null };
  }
  // sessionStorage cannot store a real null; the literal "null" marks
  // an observed-empty stamp so we can tell it from "never seen".
  const raw = readStorage(stampKey(mailboxId));
  if (raw == null) return { seen: false, value: null };
  if (raw === 'null') return { seen: true, value: null };
  return { seen: true, value: raw };
}

function writeStamp(mailboxId: string, value: string | null): void {
  memoryStamps.set(mailboxId, value);
  writeStorage(stampKey(mailboxId), value == null ? 'null' : value);
}

/**
 * Remember that the user just asked for a manual incremental sync so
 * the next `last_synced_at` advance on this mailbox is attributed as
 * `trigger: 'manual'` instead of the background default.
 */
export function markManualSyncRequested(mailboxId: string): void {
  pendingManual.set(mailboxId, Date.now());
}

/**
 * Observe one mailbox's initial-sync readiness. Fires `sync_started` on
 * the first in-progress state and `sync_completed` on the matching
 * terminal transition. Completions stay paired with an observed start
 * (including a start observed before a remount in this tab).
 */
export function observeSyncReadiness(
  mailboxId: string,
  readiness: SyncReadiness,
  trigger: SyncTrigger = 'initial',
): void {
  const inProgress = readiness === 'queued' || readiness === 'syncing';
  const open = readPair(mailboxId);

  if (inProgress) {
    if (open == null) {
      const pair: OpenPair = { startedAt: Date.now(), trigger };
      writePair(mailboxId, pair);
      void track('sync_started', { sync_id: null, mailbox_id: mailboxId, trigger });
    }
    return;
  }

  if (open != null && (readiness === 'ready' || readiness === 'failed')) {
    writePair(mailboxId, null);
    void track('sync_completed', {
      sync_id: null,
      mailbox_id: mailboxId,
      messages_indexed: -1,
      duration_ms: Date.now() - open.startedAt,
      outcome: readiness === 'ready' ? 'success' : 'failed',
    });
  }
}

/**
 * Observe `last_synced_at` on an already-ready mailbox. The first
 * stamp seen in this tab is recorded silently (historical). A later
 * *different* non-null stamp is a completed incremental/manual run.
 *
 * `null → timestamp` is the initial-sync stamp and is owned by
 * {@link observeSyncReadiness} — this path stays silent for it.
 */
export function observeLastSyncedAt(
  mailboxId: string,
  lastSyncedAt: string | null | undefined,
  readiness: SyncReadiness,
): void {
  const current = lastSyncedAt ?? null;
  const prev = readStamp(mailboxId);

  if (!prev.seen) {
    writeStamp(mailboxId, current);
    return;
  }

  if (current === prev.value) return;
  writeStamp(mailboxId, current);

  // Initial-sync stamp (null → T) or a stamp while still not ready:
  // the readiness observer owns that completion.
  if (prev.value == null || current == null || readiness !== 'ready') return;
  // An open initial-sync pair will complete on the ready transition
  // in the same tick — don't emit a second completion for the stamp.
  if (readPair(mailboxId) != null) return;

  const manualAt = pendingManual.get(mailboxId);
  pendingManual.delete(mailboxId);
  const trigger: SyncTrigger = manualAt != null ? 'manual' : 'pubsub';
  const duration_ms = manualAt != null ? Math.max(0, Date.now() - manualAt) : 0;

  void track('sync_started', { sync_id: null, mailbox_id: mailboxId, trigger });
  void track('sync_completed', {
    sync_id: null,
    mailbox_id: mailboxId,
    messages_indexed: -1,
    duration_ms,
    outcome: 'success',
  });
}

/** Test seam — clears tab-scoped pairing state between cases. */
export function resetSyncLifecycleForTests(): void {
  memoryPairs.clear();
  memoryStamps.clear();
  pendingManual.clear();
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key != null && (key.startsWith(PAIR_PREFIX) || key.startsWith(STAMP_PREFIX))) {
        keys.push(key);
      }
    }
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
