import type { ProviderRejection } from '../adapters/llm-circuit-breaker.js';

/**
 * Groups every breaker trip into one Sentry issue. The reason and status
 * are tags on the event; putting either in the fingerprint would split
 * one outage into several issues.
 */
export const LLM_PROVIDER_REJECTED_FINGERPRINT = ['llm.provider_rejected'] as const;

/**
 * The one Sentry capture for an LLM provider refusal. The worker wires
 * this as `LlmCircuitBreaker`'s `onTrip`, which runs only on the
 * transition into a pause. No-op unless the worker's Sentry client is
 * actually installed — `captureMessage` before `init` is dropped.
 */
export function captureLlmProviderRejection(rejection: ProviderRejection): void {
  if (!process.env.SENTRY_DSN || process.env.WORKER_SENTRY_ENABLED !== 'true') return;
  void import('@sentry/node')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTag('reason', rejection.reason);
        scope.setTag('response_status', String(rejection.status));
        scope.setFingerprint([...LLM_PROVIDER_REJECTED_FINGERPRINT]);
        Sentry.captureMessage('llm.provider_rejected', 'error');
      });
    })
    .catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'llm.provider_rejected_report_failed',
          error: err instanceof Error ? err.constructor.name : typeof err,
        }),
      );
    });
}
