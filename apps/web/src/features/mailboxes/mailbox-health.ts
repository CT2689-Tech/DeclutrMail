import type { SyncStatus } from '@declutrmail/shared/contracts';

/** Worker classification for a revoked/expired Gmail OAuth grant. */
export const INVALID_GRANT_CODE = 'InvalidGrantError';

// Surfaces reading an INITIAL-sync `error_code` directly use
// `AUTH_RECOVERY_ERROR_CODES` from `@declutrmail/shared/contracts`.
// `syncStatusNeedsReconnect` below stays `InvalidGrantError`-only to match
// the backend's `me.needsReconnect` / `getNeedsReconnectByMailbox` sweep
// contract; widening that is a separate, worker-policy-adjacent change.

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
