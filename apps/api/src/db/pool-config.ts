/** Explicit per-instance client cap; transaction-pool clients are not backends. */
export function apiPoolOptions(env: NodeJS.ProcessEnv = process.env): { max: number } {
  const raw = env.API_DB_POOL_MAX;
  if (raw === undefined || raw.trim() === '') return { max: 10 };
  const max = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(max) || max < 1 || max > 20) {
    throw new Error('API_DB_POOL_MAX must be an integer between 1 and 20');
  }
  return { max };
}
