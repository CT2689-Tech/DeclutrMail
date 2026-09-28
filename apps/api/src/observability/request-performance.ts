import { AsyncLocalStorage } from 'node:async_hooks';

// Closed names only: never attach SQL, route parameters or mailbox content.
const OPERATIONS = new Set([
  'triage.enrichment',
  'auth.sync-state',
  'autopilot.observe',
  'activity.lineages',
  'activity.stats',
  'followups.scan',
] as const);

export type RequestOperation =
  | 'triage.enrichment'
  | 'auth.sync-state'
  | 'autopilot.observe'
  | 'activity.lineages'
  | 'activity.stats'
  | 'followups.scan';

interface OperationTiming {
  count: number;
  failures: number;
  durationMs: number;
  maxDurationMs: number;
}

export interface RequestPerformance {
  closed: boolean;
  operations: Partial<Record<RequestOperation, OperationTiming>>;
}

const storage = new AsyncLocalStorage<RequestPerformance>();

/** Sampling is optional and never prevents a request from running. */
export function createRequestPerformance(
  rawRate = process.env.HTTP_PERFORMANCE_SAMPLE_RATE,
  random = Math.random,
): RequestPerformance | undefined {
  const parsed = rawRate === undefined || rawRate.trim() === '' ? 0.1 : Number(rawRate);
  const rate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
  return rate > 0 && random() < rate ? { closed: false, operations: {} } : undefined;
}

export function withRequestPerformance<T>(
  context: RequestPerformance | undefined,
  work: () => T,
): T {
  return context ? storage.run(context, work) : work();
}

/**
 * Application-side elapsed time, including network/pool waits, not SQL CPU time.
 * Concurrent operation durations can overlap; never subtract their sum from the
 * HTTP duration. No spans or exception payloads leave this bounded accumulator.
 */
export async function measureRequestOperation<T>(
  name: RequestOperation,
  work: () => PromiseLike<T> | T,
): Promise<T> {
  const context = storage.getStore();
  if (!context || context.closed || !OPERATIONS.has(name)) return work();
  const start = performance.now();
  let failed = false;
  try {
    return await work();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!context.closed) {
      const durationMs = performance.now() - start;
      const timing = (context.operations[name] ??= {
        count: 0,
        failures: 0,
        durationMs: 0,
        maxDurationMs: 0,
      });
      timing.count += 1;
      timing.failures += Number(failed);
      timing.durationMs += durationMs;
      timing.maxDurationMs = Math.max(timing.maxDurationMs, durationMs);
    }
  }
}
