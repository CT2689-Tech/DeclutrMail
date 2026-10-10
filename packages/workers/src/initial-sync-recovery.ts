/** Recovery after BullMQ's ordinary attempts are exhausted, independent of Redis. */
export const INITIAL_RECOVERY_LIMIT = 3;
export const INITIAL_RECOVERY_BASE_MS = 15 * 60_000;
export const INITIAL_RECOVERY_ERROR_CODES = [
  'TransientError',
  'RateLimitError',
  'GmailQuotaError',
] as const;

export function initialRecoveryDelay(
  errorCode: string,
  recoveries: number,
  retryAfterMs?: number,
): number | null {
  if (
    !INITIAL_RECOVERY_ERROR_CODES.includes(
      errorCode as (typeof INITIAL_RECOVERY_ERROR_CODES)[number],
    ) ||
    recoveries >= INITIAL_RECOVERY_LIMIT
  )
    return null;
  const providerDelay =
    Number.isFinite(retryAfterMs) && (retryAfterMs ?? 0) > 0 ? retryAfterMs! : 0;
  return Math.max(INITIAL_RECOVERY_BASE_MS * 2 ** Math.max(0, recoveries), providerDelay);
}
