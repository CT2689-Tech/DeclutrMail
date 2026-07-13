// Next.js loads this browser instrumentation entry on every route. Keep it
// deliberately tiny: the Sentry SDK and telemetry scrubber live behind the
// DSN-gated dynamic import in `src/lib/sentry.ts`.

import { captureRouterTransitionStart, scheduleSentryBrowserInit } from '@/lib/sentry';

// Install the tiny error bridge and start the SDK during a bounded idle window.
// With no DSN this is a synchronous no-op: no chunk import and no listeners.
scheduleSentryBrowserInit();

/**
 * Next 15 requires this hook to be synchronous. Pre-init transition timing is
 * stale by the time the SDK loads, so the facade schedules init but drops it.
 */
export function onRouterTransitionStart(href: string, navigationType: string): void {
  captureRouterTransitionStart(href, navigationType);
}
