import { AUTH_RECOVERY_ERROR_CODES, type SyncStatus } from '@declutrmail/shared/contracts';

/** Worker classification for a revoked/expired Gmail OAuth grant. */
export const INVALID_GRANT_CODE = 'InvalidGrantError';

/** Worker classification for an expired-but-not-revoked Gmail OAuth grant. */
export const AUTH_EXPIRED_CODE = 'AuthExpiredError';

/**
 * INITIAL-sync `error_code`s that send the user to reconnect Gmail.
 *
 * QA-sync-20260831-07 added `AuthExpiredError` to the onboarding gate and
 * the header's failed indicator, while Settings, Home, Triage and Senders
 * kept offering a retry for it — two answers on one screen. The rule now
 * lives once, in `syncStatusNeedsReconnect` below and its server twin
 * (`SyncService.getMailboxHealth`, which feeds `me.needsReconnect`), and
 * every surface reads one of the two. A reconnect also re-queues the
 * scan, so it covers whatever a retry would.
 *
 * Only the INITIAL-sync field: no sweep reads it (a failed initial sync is
 * already out of every sweep), so this changes what the user is shown,
 * never what a worker does. The incremental check stays
 * `InvalidGrantError`-only to match the workers' own reconnect gate
 * (packages/workers/src/mailbox-reconnect.ts).
 */
// Initial-sync recovery codes are shared with every reconnect surface.

/**
 * True only while the scoped mailbox's Gmail grant currently needs
 * reauthorization.
 *
 * Incremental failures are current until a success stamp catches up; an
 * initial-sync grant failure remains current while its failed readiness row
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

  return (
    incrementalAuthError ||
    (status.error_code != null && AUTH_RECOVERY_ERROR_CODES.has(status.error_code))
  );
}

/**
 * The next step for a failed scan, named as Settings → Gmail accounts
 * offers it. A mailbox needing reconnect shows "Needs reconnect" and a
 * Reconnect button there — never a retry (`mailboxes-card.tsx`) — so
 * Triage, Senders, Home and the scan toast used to send those users to a
 * retry that does not exist. Pass the server's `me.mailboxes[].needsReconnect`
 * (same rule as `syncStatusNeedsReconnect`).
 */
export function failedScanSettingsStep(needsReconnect: boolean): string {
  // "Scan again": the label of the button Settings shows for a retry.
  return needsReconnect
    ? 'Reconnect it in Settings → Gmail accounts.'
    : 'Scan again in Settings → Gmail accounts.';
}
