/** Explicit per-process budgets; deployment replica counts must be budgeted separately. */
export function workerRuntimeConfig(env: Record<string, string | undefined>) {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`${key} must be an integer between 1 and ${max}`);
    return value;
  };
  return {
    dbPoolMax: integer('WORKER_DB_POOL_MAX', 10, 100),
    lockPoolMax: integer('WORKER_LOCK_POOL_MAX', 10, 100),
    // Applies to the bounded reconciliation transaction, not initial backfill rebuilds.
    sweepStatementTimeoutMs: integer('WORKER_SWEEP_STATEMENT_TIMEOUT_MS', 25_000, 55_000),
  };
}
