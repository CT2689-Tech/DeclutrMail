/**
 * Initial-sync recovery mapping — the onboarding gate's branch table
 * (D109 / D224).
 *
 * The worker stores `error.name` on `provider_sync_state.error_code`.
 * This file maps those names onto **stable reason codes** Onboarding
 * owns copy for. Do not invent new worker error classes here — consume
 * the names the sync layer already writes, plus aliases the
 * OAuth-taxonomy / quota-resume PRs are expected to land.
 *
 * Reason codes (UI branches on these, not on copy strings):
 *   - `insufficient_scopes` — permanent; Reconnect only, never Retry
 *   - `invalid_grant` / `reconnect_required` — Reconnect only
 *   - `rate_limit` — Retry (quota-resume). `partlyReady` when progress
 *     has already moved, so Onboarding can offer Finish sync | Continue
 *   - `stuck` — stale heartbeat while still queued/syncing; Retry
 *   - `unknown` — default Retry (a reconnect against a live grant is
 *     the worse wrong button)
 *
 * `syncStatusNeedsReconnect` / `me.needsReconnect` stay
 * `InvalidGrantError`-only on purpose: that predicate feeds periodic
 * sweeps. Widening it is a worker-policy change, not this mapping.
 */

/** Worker `error.name` values whose only real recovery is a fresh Gmail grant. */
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

/** Worker names that should Retry (re-queue / quota-resume), not Reconnect. */
export const INITIAL_SYNC_RETRY_ERROR_CODES = [
  'RateLimitError',
  'GmailQuotaError',
  'TransientError',
  'PermanentError',
  'ValidationError',
] as const;

export type InitialSyncRetryErrorCode = (typeof INITIAL_SYNC_RETRY_ERROR_CODES)[number];

export type InitialSyncRecoveryAction = 'retry' | 'reconnect';

/**
 * Stable reason codes the onboarding gate branches on. Copy is owned
 * by Onboarding and is not sourced from these strings.
 */
export type InitialSyncReasonCode =
  | 'insufficient_scopes'
  | 'rate_limit'
  | 'invalid_grant'
  | 'reconnect_required'
  | 'stuck'
  | 'unknown';

export interface InitialSyncRecovery {
  reason: InitialSyncReasonCode;
  action: InitialSyncRecoveryAction;
  /**
   * Quota (or a stuck scan) that already wrote progress — the index is
   * partly populated. Onboarding may offer Finish sync | Continue.
   * Derived from `progress_pct > 0` until the sync layer exposes an
   * indexed-message count; absence of progress is not "partly ready".
   */
  partlyReady: boolean;
}

const INSUFFICIENT_SCOPE_CODES: ReadonlySet<string> = new Set(['ProviderPermissionError']);
const INVALID_GRANT_CODES: ReadonlySet<string> = new Set(['InvalidGrantError']);
const RECONNECT_REQUIRED_CODES: ReadonlySet<string> = new Set(['AuthExpiredError']);
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set(['RateLimitError', 'GmailQuotaError']);
const RECONNECT_CODES: ReadonlySet<string> = new Set(INITIAL_SYNC_RECONNECT_ERROR_CODES);

export function initialSyncRecoveryAction(
  errorCode: string | null | undefined,
): InitialSyncRecoveryAction {
  return errorCode != null && RECONNECT_CODES.has(errorCode) ? 'reconnect' : 'retry';
}

export function initialSyncRecovery(input: {
  errorCode?: string | null | undefined;
  stuck?: boolean;
  progressPct?: number;
}): InitialSyncRecovery {
  const code = input.errorCode ?? null;
  const partlyReady = (input.progressPct ?? 0) > 0;

  if (code != null && INSUFFICIENT_SCOPE_CODES.has(code)) {
    return { reason: 'insufficient_scopes', action: 'reconnect', partlyReady: false };
  }
  if (code != null && INVALID_GRANT_CODES.has(code)) {
    return { reason: 'invalid_grant', action: 'reconnect', partlyReady: false };
  }
  if (code != null && RECONNECT_REQUIRED_CODES.has(code)) {
    return { reason: 'reconnect_required', action: 'reconnect', partlyReady: false };
  }
  if (code != null && RATE_LIMIT_CODES.has(code)) {
    return { reason: 'rate_limit', action: 'retry', partlyReady };
  }
  if (input.stuck === true) {
    return { reason: 'stuck', action: 'retry', partlyReady };
  }
  return { reason: 'unknown', action: 'retry', partlyReady: false };
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
