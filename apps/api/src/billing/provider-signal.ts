import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The billing-verdict cron's job deadline, visible to provider HTTP and
 * to the subscription advisory lock without a new required argument on
 * `BillingProvider`.
 *
 * Checkout, webhooks, and drift reads never enter this store, so they
 * keep a plain `AbortSignal.timeout` and an unbounded lock wait. Only
 * `billingVerdictDeps` calls `runWithVerdictSignal`.
 */
const verdictSignal = new AsyncLocalStorage<AbortSignal>();

// Interactive history reads have their own budget. Keep it separate from the
// verdict scope, which also changes database lock and write behavior.
const billingReadSignal = new AsyncLocalStorage<AbortSignal>();

export function runWithBillingReadSignal<T>(
  signal: AbortSignal,
  read: () => Promise<T>,
): Promise<T> {
  return billingReadSignal.run(signal, read);
}

/**
 * Transaction-local Postgres cap for verdict-pass reads and the advisory
 * lock they take. Healthy passes finish in well under a second. 15s stops
 * a stuck query or lock wait; webhook transactions outside this scope are
 * unchanged.
 */
export const VERDICT_DB_STATEMENT_TIMEOUT_MS = 15_000;

export function currentVerdictSignal(): AbortSignal | undefined {
  return verdictSignal.getStore();
}

/** No signal — call through unchanged. A dropped signal must not throw. */
export function runWithVerdictSignal<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!signal) return fn();
  return verdictSignal.run(signal, fn);
}

/**
 * The adapter's own request timeout, composed with the job deadline when
 * a verdict pass is on the stack. Whichever fires first aborts the fetch,
 * including a stalled body read. Interactive billing history may also provide
 * a read-only deadline; neither scope changes the other. Without either scope
 * this is exactly `AbortSignal.timeout(timeoutMs)`.
 */
export function billingProviderSignal(timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  const parents = [currentVerdictSignal(), billingReadSignal.getStore()].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  return parents.length === 0 ? timeout : AbortSignal.any([...parents, timeout]);
}

/** Stop before the next provider write or entitlement projection. */
export function throwIfVerdictStopped(): void {
  const signal = currentVerdictSignal();
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(
    typeof reason === 'string' && reason.length > 0 ? reason : 'billing verdict stopped',
  );
}
