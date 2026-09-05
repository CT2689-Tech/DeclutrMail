/**
 * Worker error classification (D203).
 *
 * `BaseDeclutrWorker` catches these typed errors and decides retry vs.
 * dead-letter from the TYPE — separate from the retry policy (which only
 * sets attempt counts + backoff). Any unrecognised error is treated as
 * `TransientError` (the safe default — retry).
 *
 * Only the classes the initial-sync path actually branches on are
 * defined; D203's other named errors (`PoisonJobError`,
 * `ProviderPermissionError`) land with the workers that need them.
 */

/** Retryable: transient network / provider 5xx. The safe default. */
export class TransientError extends Error {
  override readonly name = 'TransientError';
}

/** Retryable: provider 429. `retryAfterMs` echoes the Retry-After header. */
export class RateLimitError extends Error {
  override readonly name = 'RateLimitError';
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Retryable after a token refresh: the access token expired mid-job. */
export class AuthExpiredError extends Error {
  override readonly name = 'AuthExpiredError';
}

/**
 * NOT retryable: the OAuth grant is revoked or lacks required permissions. The
 * mailbox must be reconnected before any retry is meaningful.
 */
export class InvalidGrantError extends Error {
  override readonly name = 'InvalidGrantError';
}

/** NOT retryable: the job payload is malformed — retrying cannot help. */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

/**
 * NOT retryable: the provider rejected the request deterministically
 * (e.g. Gmail 400 `invalidArgument` — bad label id, malformed request).
 * The identical request fails identically on every attempt, so retrying
 * only burns quota; the job must fail on attempt 1.
 */
export class PermanentError extends Error {
  override readonly name = 'PermanentError';
  /**
   * The provider's machine-readable reason, when it supplied one (Gmail's
   * `error.errors[0].reason`, e.g. `invalidArgument`, `failedPrecondition`).
   *
   * A closed provider enum, never free text, so a caller can branch on WHY
   * without parsing `message` — some 400s describe the REQUEST (fail the
   * job) and some describe ONE resource (skip it and carry on).
   */
  readonly reason: string | undefined;

  constructor(message: string, reason?: string) {
    super(message);
    this.reason = reason;
  }
}

/** Errors a retry can never fix — the base class dead-letters immediately. */
export type NonRetryableError = InvalidGrantError | ValidationError | PermanentError;

/**
 * The provider's machine-readable reason, when the error carries one.
 *
 * A closed provider enum (`failedPrecondition`, `invalidArgument`, …) — safe
 * for logs and Sentry tags in a codebase that deliberately never ships
 * `Error.message` off-box.
 */
export function providerErrorReason(err: unknown): string | undefined {
  return err instanceof PermanentError ? err.reason : undefined;
}

/** True when retrying the job is pointless (D203 error classification). */
export function isNonRetryable(err: unknown): err is NonRetryableError {
  return (
    err instanceof InvalidGrantError ||
    err instanceof ValidationError ||
    err instanceof PermanentError
  );
}
