import type { SyncStatus } from '@declutrmail/shared/contracts';

/** Worker classification for a revoked/expired Gmail OAuth grant. */
export const INVALID_GRANT_CODE = 'InvalidGrantError';

/** Worker classification for an expired-but-not-revoked Gmail OAuth grant. */
export const AUTH_EXPIRED_CODE = 'AuthExpiredError';

/**
 * Error codes whose only real recovery is reconnecting Gmail, for
 * surfaces reading an INITIAL-sync `error_code` directly rather than
 * `syncStatusNeedsReconnect` below (which stays `InvalidGrantError`-only
 * to match the backend's `me.needsReconnect`/`getNeedsReconnectByMailbox`
 * sweep contract — widening THAT is a separate, worker-policy-adjacent
 * change, deliberately not made here).
 *
 * QA-sync-20260831-07 added `AuthExpiredError` display-only to the
 * onboarding gate's own local set; a later Codex adversarial review of
 * the same QA round found `SyncNowButton`'s failed-indicator still used
 * only `InvalidGrantError`, offering a doomed "Scan again" retry against
 * the same dead token the onboarding gate correctly reconnects for. Both
 * surfaces now read this one set instead of keeping their own copies.
 */
export const AUTH_RECOVERY_ERROR_CODES = new Set([INVALID_GRANT_CODE, AUTH_EXPIRED_CODE]);

/**
 * True only while the scoped mailbox's Gmail grant currently needs
 * reauthorization.
 *
 * Incremental failures are current until a success stamp catches up; an
 * initial-sync invalid grant remains current while its failed readiness row
 * carries `error_code`. Keeping this projection pure lets every surface use
 * the same answer from the shared mailbox-keyed React Query cache.
 */
export function syncStatusNeedsReconnect(status: SyncStatus | undefined): boolean {
  if (!status) return false;

  const syncedAt = status.last_synced_at ?? null;
  const errorAt = status.last_sync_error_at ?? null;
  const incrementalAuthError =
    status.last_sync_error_code === INVALID_GRANT_CODE &&
    errorAt !== null &&
    (syncedAt === null || new Date(errorAt).getTime() > new Date(syncedAt).getTime());

  return incrementalAuthError || status.error_code === INVALID_GRANT_CODE;
}
