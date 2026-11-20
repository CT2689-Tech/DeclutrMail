/**
 * Supavisor refuses a new session-mode client once its pool is full:
 * `(EMAXCONNSESSION) max clients reached in session mode - max clients
 * are limited to pool_size: N`. During a Cloud Run rollout the old worker
 * revision still holds its session clients, so the new one can meet a
 * full pool for a few seconds and must not crash on it (2026-11-19: the
 * worker exited at boot, crash-looped, and failed four deploys in a row).
 */
export function isPoolFull(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /EMAXCONNSESSION|max clients reached/i.test(message);
}

/**
 * Waits between tries while the pooler is full. 119 s in total: inside
 * the worker's startup probe window (24 × 10 s in deploy-cloud-run.yml),
 * so a revision that gets a slot still becomes Ready, and one that never
 * does still fails the deploy loudly instead of hanging.
 */
export const POOL_FULL_RETRY_DELAYS_MS: readonly number[] = [
  2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000,
];

/**
 * Run `connect`; while it fails because the pool is full, wait and try
 * again. Any other error, or a full pool after the last wait, is thrown
 * unchanged, so a real outage still fails boot.
 */
export async function retryWhilePoolFull<T>(
  connect: () => Promise<T>,
  options: {
    delaysMs: readonly number[];
    onRetry: (attempt: number, delayMs: number) => void;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      const delayMs = options.delaysMs[attempt];
      if (delayMs === undefined || !isPoolFull(error)) throw error;
      options.onRetry(attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
}
