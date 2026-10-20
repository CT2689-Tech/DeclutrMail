const LOCK_NOT_AVAILABLE = '55P03';
const LOCK_TIMEOUT_MESSAGE = 'canceling statement due to lock timeout';

/**
 * True when Postgres cancelled a statement because `lock_timeout` elapsed
 * (`55P03` / "canceling statement due to lock timeout"). Drizzle wraps the
 * driver error, so the SQLSTATE may sit on `cause` rather than the throw.
 */
export function isPostgresLockTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === LOCK_NOT_AVAILABLE) return true;
    if (
      typeof record.message === 'string' &&
      record.message.toLowerCase().includes(LOCK_TIMEOUT_MESSAGE)
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}
