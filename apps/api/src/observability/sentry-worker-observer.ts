import type {
  BackgroundFailureContext,
  WorkerFailureContext,
  WorkerObserver,
} from '@declutrmail/workers';

/**
 * Sentry-backed `WorkerObserver` (D159 + D203 seam wired through).
 *
 * Routes BOTH lifecycles — `BaseDeclutrWorker` terminal failures AND the
 * background reconciler's error path — through `Sentry.captureException`
 * with shared tags. With no `SENTRY_DSN` configured `initSentry()` was a
 * no-op and `@sentry/node`'s functions are inert; the explicit `dsnSet`
 * gate here keeps that contract crisp (a `Sentry.captureException` call
 * before `init` is silently dropped — we don't want operators searching
 * for events that never made it out).
 *
 * Privacy posture (D7, D228): the contexts here are metric-only per the
 * `WorkerObserver` contract (worker name, job id, mailbox id, attempt,
 * policy / kind, tags). The Sentry SDK's `beforeSend` (see
 * `./sentry.ts`) runs the shared `scrubTelemetryPayload` as defense in
 * depth. Callers must still not pass body / snippet / token data here.
 *
 * Closes the FOUNDER-FOLLOWUPS 2026-05-22 "D-CANDIDATE: D159 Sentry seam
 * for background reconciler" — the reconciler in `apps/api/src/worker.ts`
 * now calls `captureBackgroundFailure` through this same observer.
 */
export interface SentryWorkerObserverOptions {
  /** Whether `SENTRY_DSN` was set + the SDK initialised. False = no-op. */
  dsnSet: boolean;
}

export async function createSentryWorkerObserver(
  opts: SentryWorkerObserverOptions,
): Promise<WorkerObserver> {
  if (!opts.dsnSet) {
    // No DSN → return a no-op (we only own logging then; observer is
    // additive). The structured log line in `BaseDeclutrWorker` still
    // fires, so operators in dev/test still see the failure.
    return {
      captureFailure() {},
      captureBackgroundFailure() {},
    };
  }
  // Dynamic import keeps the heavy @sentry/node bundle out of test/dev
  // paths where the DSN is unset (mirrors `initSentry`'s same pattern).
  const Sentry = await import('@sentry/node');
  return {
    captureFailure(error: Error, ctx: WorkerFailureContext): void {
      Sentry.withScope((scope) => {
        scope.setTags({
          worker: ctx.workerName,
          policy: ctx.policy,
          job_id: ctx.jobId,
          ...(ctx.mailboxAccountId ? { mailbox_account_id: ctx.mailboxAccountId } : {}),
        });
        scope.setContext('worker', {
          attempt: ctx.attempt,
        });
        Sentry.captureException(error);
      });
    },
    captureBackgroundFailure(error: Error, ctx: BackgroundFailureContext): void {
      Sentry.withScope((scope) => {
        scope.setTags({
          kind: ctx.kind,
          ...stringifyTags(ctx.tags),
        });
        Sentry.captureException(error);
      });
    },
  };
}

/** Sentry tags are `string | number | boolean`; clip to that shape. */
function stringifyTags(
  tags: Record<string, string | number> | undefined,
): Record<string, string | number> {
  if (!tags) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(tags)) {
    out[k] = v;
  }
  return out;
}
