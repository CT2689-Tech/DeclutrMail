/**
 * Initial-sync recovery mapping — the onboarding gate's Retry vs
 * Reconnect branch table (D109 / D224).
 *
 * The worker stores `error.name` on `provider_sync_state.error_code`.
 * Onboarding owns the recovery copy; this file only names the action
 * the UI should offer. Do not invent new worker error classes here —
 * consume the names the sync layer already writes, plus the aliases
 * that the OAuth-taxonomy / quota-resume PRs are expected to land
 * (`ProviderPermissionError`, `GmailQuotaError`) so the gate does not
 * silently offer a doomed retry the moment those names appear.
 *
 * `syncStatusNeedsReconnect` / `me.needsReconnect` stay
 * `InvalidGrantError`-only on purpose: that predicate feeds periodic
 * sweeps. Widening it is a worker-policy change, not this mapping.
 */

/** Codes whose only real recovery is a fresh Gmail grant. */
export const INITIAL_SYNC_RECONNECT_ERROR_CODES = [
  'InvalidGrantError',
  'AuthExpiredError',
  // Named in `packages/workers/src/worker-errors.ts`. Insufficient
  // scopes currently land as `InvalidGrantError`
  // (`gmailErrorReason === 'insufficientPermissions'`). Keep the alias
  // so a taxonomy PR cannot flip this surface back to Retry.
  'ProviderPermissionError',
] as const;

export type InitialSyncReconnectErrorCode = (typeof INITIAL_SYNC_RECONNECT_ERROR_CODES)[number];

/**
 * Codes that should Retry (re-queue / quota-resume), not Reconnect.
 * Unknown names default to retry too — a reconnect against a live
 * grant is the worse wrong button.
 */
export const INITIAL_SYNC_RETRY_ERROR_CODES = [
  'RateLimitError',
  'GmailQuotaError',
  'TransientError',
  'PermanentError',
  'ValidationError',
] as const;

export type InitialSyncRetryErrorCode = (typeof INITIAL_SYNC_RETRY_ERROR_CODES)[number];

export type InitialSyncRecoveryAction = 'retry' | 'reconnect';

const RECONNECT_CODES: ReadonlySet<string> = new Set(INITIAL_SYNC_RECONNECT_ERROR_CODES);

/** Stable reason the UI branches on. `error_code` itself stays on the wire. */
export function initialSyncRecoveryAction(
  errorCode: string | null | undefined,
): InitialSyncRecoveryAction {
  return errorCode != null && RECONNECT_CODES.has(errorCode) ? 'reconnect' : 'retry';
}

/**
 * How long a `queued` / `syncing` row may go without a heartbeat before
 * the onboarding gate treats it as stuck. Same number the initial-sync
 * reconciler uses (`STALE_SYNCING_AFTER_MS`) so the UI and the sweep
 * agree on "wedged" vs "still working".
 */
export const STALE_INITIAL_SYNC_MS = 15 * 60 * 1000;

/**
 * True when the gate should leave the progress view for a recovery
 * surface even though readiness is still `queued`/`syncing`.
 *
 * `updated_at` omitted (pre-field responses, stories that aren't
 * modelling stall) never counts as stuck — absence is not evidence.
 */
export function isStaleInitialSync(
  status: {
    readiness_status: string;
    updated_at?: string | null | undefined;
  },
  nowMs: number,
): boolean {
  if (status.readiness_status !== 'queued' && status.readiness_status !== 'syncing') {
    return false;
  }
  if (status.updated_at == null || status.updated_at === '') return false;
  const heartbeatMs = Date.parse(status.updated_at);
  if (!Number.isFinite(heartbeatMs)) return false;
  return nowMs - heartbeatMs >= STALE_INITIAL_SYNC_MS;
}
