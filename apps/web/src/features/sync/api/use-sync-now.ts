'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@declutrmail/shared';

import { apiPost } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import { addBreadcrumb } from '@/lib/sentry';
import { useAuth } from '@/features/auth/auth-provider';
import type { EventPayloads } from '@declutrmail/shared/observability';

/**
 * Wire response shape of `POST /api/v1/sync/incremental`.
 *
 * Matches the `Envelope<{ outcome, cursor_history_id }>` returned by
 * `SyncController.postIncremental` — `outcome: 'enqueued' | 'noop'` lets
 * the FE distinguish "checking for new email" from "already in
 * progress" without re-polling status. `cursor_history_id` is logged on
 * the Sentry breadcrumb for trace continuity into the worker logs.
 */
export interface SyncNowResponse {
  outcome: 'enqueued' | 'noop';
  cursor_history_id: string;
}

/**
 * Strongly typed error code list — drives the FE toast copy below
 * + lets future surfaces (e.g. a Sentry-tagged retry button) discriminate
 * on the cause.
 *
 *   - `SYNC_NOT_READY` — initial sync hasn't completed yet; FE should
 *     route the user to the sync-gate progress card, not a generic
 *     error toast. Per CLAUDE.md §8 "guard-4xx-as-designed-state".
 *   - `RATE_LIMITED` — 429 from the `gmail-action` bucket. The button
 *     re-enables after `Retry-After` seconds.
 *   - `NO_ACTIVE_MAILBOX` — the user has no connected mailbox; the
 *     app shell normally takes over before this fires, but kept here
 *     defensively.
 *   - `UNKNOWN` — everything else, including 500s.
 */
export type SyncNowErrorCode = 'SYNC_NOT_READY' | 'RATE_LIMITED' | 'NO_ACTIVE_MAILBOX' | 'UNKNOWN';

export class SyncNowError extends Error {
  readonly code: SyncNowErrorCode;
  readonly retryAfterSec: number | null;
  constructor(code: SyncNowErrorCode, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

type Source = EventPayloads['sync_now_clicked']['source'];

/**
 * Mutation hook for the "Sync now" button.
 *
 * Surfaces using this:
 *   - `SyncNowButton` in `AppShell.topbarRight`
 *   - Brief's empty-state "Refresh" CTA
 *   - Senders' Senders-list error-state "Try again" CTA
 *   - Sender Detail's overflow "Sync now"
 *
 * Each call site passes a distinct `source` so PostHog can attribute
 * which surface drove the click — the funnel question "is anyone using
 * Sync from the senders list" only resolves with this discriminator.
 *
 * On success:
 *   1. Emits `sync_now_clicked` to PostHog (closed-union event).
 *   2. Invalidates the senders, activity, and brief query roots so the
 *      next render shows fresh data once the worker finishes. The
 *      worker advances `provider_sync_state.last_history_id` + writes
 *      mail_messages; without the invalidate, the FE would show
 *      stale-from-cache until the next route change.
 *   3. Toast feedback: 'enqueued' → "Checking Gmail…"; 'noop' → already
 *      running.
 *
 * On error:
 *   - SYNC_NOT_READY → routes to the sync gate (toast says so + does
 *     not retry).
 *   - RATE_LIMITED → toast with the cooldown.
 *   - NO_ACTIVE_MAILBOX / UNKNOWN → generic toast.
 *
 * Sentry breadcrumbs trace every attempt (success + error) so a
 * production "I clicked but nothing happened" report has the full
 * timeline (D159).
 */
export function useSyncNow(source: Source) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const activeMailboxId = me.activeMailboxId ?? null;

  return useMutation<SyncNowResponse, SyncNowError, void>({
    mutationFn: async () => {
      try {
        const envelope = await apiPost<SyncNowResponse>('/api/v1/sync/incremental');
        return envelope.data;
      } catch (err) {
        // Translate the wire error into the typed SyncNowError so toast
        // copy + Sentry tagging stay surface-agnostic.
        throw translateSyncNowError(err);
      }
    },
    onMutate: () => {
      if (activeMailboxId !== null) {
        void track('sync_now_clicked', { mailbox_id: activeMailboxId, source });
      }
      addBreadcrumb({
        category: 'sync',
        message: `sync-now: requested (source=${source})`,
        level: 'info',
      });
    },
    onSuccess: (data) => {
      addBreadcrumb({
        category: 'sync',
        message: `sync-now: ${data.outcome} cursor=${data.cursor_history_id}`,
        level: 'info',
      });
      // Invalidate the per-feature roots — keep this list explicit
      // rather than `invalidateQueries()` (the global no-arg form
      // triggers a refetch storm we don't want on a tab that's not
      // open). See FOUNDER-FOLLOWUPS § "scope-change ⇒ reset scoped
      // cache" — same invariant rephrased.
      void qc.invalidateQueries({ queryKey: ['senders'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      void qc.invalidateQueries({ queryKey: ['brief'] });
      void qc.invalidateQueries({ queryKey: ['sender-detail'] });

      if (data.outcome === 'enqueued') {
        toast('Checking Gmail for new emails…', 'info');
      } else {
        // noop — the worker is already mid-flight. The user's click
        // landed but did not add a duplicate job.
        toast('Sync already in progress — new emails will appear shortly.', 'info');
      }
    },
    onError: (err) => {
      addBreadcrumb({
        category: 'sync',
        message: `sync-now: error ${err.code}`,
        level: 'error',
      });
      switch (err.code) {
        case 'SYNC_NOT_READY':
          toast('Initial sync is still in progress — give it a minute.', 'info');
          break;
        case 'RATE_LIMITED':
          toast(`Slow down — try again in ${err.retryAfterSec ?? 60} seconds.`, 'warn');
          break;
        case 'NO_ACTIVE_MAILBOX':
          toast('Reconnect a mailbox to sync.', 'danger');
          break;
        case 'UNKNOWN':
          toast('Sync failed — please try again.', 'danger');
          break;
        default:
          // Exhaustiveness gate (typescript-reviewer 2026-06-06). When
          // a new SyncNowErrorCode is added to the union, TS narrows
          // `err.code` to `never` here and an explicit `never` assignment
          // fails compile — better than a silent `default` catch-all
          // that would route the new code into the generic 'Sync failed'
          // toast (and hide a missing branch).
          assertNeverSyncNowErrorCode(err.code);
      }
    },
  });
}

/** Compile-time exhaustiveness gate for the SyncNowErrorCode switch. */
function assertNeverSyncNowErrorCode(x: never): never {
  throw new Error(`unhandled SyncNowErrorCode: ${String(x)}`);
}

/**
 * Map the wire envelope's error shape (D202 — `{ error: { code, ... }}`)
 * + raw HTTP failures into the closed `SyncNowErrorCode` union. Kept as
 * a plain helper (no React deps) so the unit test in
 * `use-sync-now.test.ts` can exercise every branch without mocking
 * the mutation host.
 */
export function translateSyncNowError(err: unknown): SyncNowError {
  if (err instanceof SyncNowError) return err;

  // The shared client throws ApiError with `{ status, body }`. The
  // body is the D202 error envelope: `{ error: { code, message } }`.
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: unknown }).body;
    const code = readErrorCode(body);
    const retryAfter = readRetryAfter(err);
    if (status === 409 || code === 'SYNC_NOT_READY') {
      return new SyncNowError('SYNC_NOT_READY', 'Initial sync not complete yet.');
    }
    if (status === 429) {
      return new SyncNowError('RATE_LIMITED', 'Rate-limited.', retryAfter);
    }
    if (status === 400 && code === 'SYNC_NOT_READY') {
      return new SyncNowError('SYNC_NOT_READY', 'Initial sync not complete yet.');
    }
    if (status === 401 || code === 'NO_ACTIVE_MAILBOX') {
      return new SyncNowError('NO_ACTIVE_MAILBOX', 'No active mailbox.');
    }
  }
  const message = err instanceof Error ? err.message : 'Unknown sync error.';
  return new SyncNowError('UNKNOWN', message);
}

function readErrorCode(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function readRetryAfter(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const headers = (err as { headers?: unknown }).headers;
  if (headers instanceof Headers) {
    const raw = headers.get('retry-after');
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
