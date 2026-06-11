'use client';

import * as Sentry from '@sentry/nextjs';

/**
 * Sentry helper surface — D159.
 *
 * Init lives in `apps/web/sentry.client.config.ts` (browser) +
 * `apps/web/sentry.server.config.ts` + `apps/web/sentry.edge.config.ts`
 * (server/edge), loaded by `instrumentation.ts` + Sentry's Next.js
 * build plugin (`withSentryConfig` in `next.config.ts`). This file is
 * the surface code's thin typed wrapper — never call `Sentry.init`
 * from here.
 *
 * Refactored 2026-06-07: dropped the lazy dynamic-import bootstrap
 * (`initSentryBrowser`) in favour of the eager-init plugin pattern.
 * Reasons:
 *   1. Source-map upload needs the eager init path so release tagging
 *      lines up with the uploaded artifacts.
 *   2. RSC + edge throws need `instrumentation.ts onRequestError`,
 *      which requires the SDK to be initialised before the first
 *      request — incompatible with lazy-on-first-use.
 *   3. The DSN gate is now inside the config files (one `if (dsn)`
 *      block per runtime). When DSN is unset, `Sentry.init` is never
 *      called → every call below resolves against an uninitialised
 *      client, which the SDK handles as a no-op via `getClient()` =>
 *      undefined. No tracking happens, exactly as before.
 *
 * The helpers stay synchronous (no more `void import(...).then(...)`)
 * which makes call-site error handling simpler — if a fire-and-forget
 * breadcrumb fails, it's the SDK's problem, not ours.
 */

/**
 * Test seam — historically reset the lazy `initialized` latch. With the
 * eager-init pattern there is no latch to reset, so this is a no-op
 * exported for backwards compatibility with any test that still
 * imports it. Tests that mock `@sentry/nextjs` via `vi.mock(...)` are
 * unaffected.
 */
export function __resetForTests(): void {
  /* no-op — see jsdoc */
}

/**
 * `initSentryBrowser` is also retained as a no-op so the App Router
 * error boundaries (`app/error.tsx` + per-feature `error.tsx` files)
 * can keep their `await initSentryBrowser()` calls without a sweep
 * across the codebase. Eager init has already happened by the time
 * any boundary mounts, so this returns immediately.
 */
export async function initSentryBrowser(): Promise<void> {
  /* no-op — eager init runs from sentry.client.config.ts */
}

/**
 * A trimmed-down version of Sentry's `Breadcrumb` type — we never use
 * the long tail (`event_id`, `type`, etc.), so an explicit shape both
 * documents the expected fields AND keeps the SDK surface narrow.
 */
export interface AppBreadcrumb {
  category: 'sync' | 'action' | 'undo' | 'navigation' | 'mailbox' | 'auth';
  message: string;
  level: 'info' | 'warning' | 'error';
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Synchronously add a breadcrumb to the active Sentry client. No-op
 * when the SDK hasn't been initialised (no DSN). Errors inside the
 * SDK are swallowed — a missing breadcrumb must never break the
 * user's interaction.
 */
export function addBreadcrumb(crumb: AppBreadcrumb): void {
  if (typeof window === 'undefined') return;
  try {
    Sentry.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level === 'warning' ? 'warning' : crumb.level,
      ...(crumb.data === undefined ? {} : { data: crumb.data }),
    });
  } catch {
    /* SDK not initialised or threw — see jsdoc */
  }
}

/**
 * Capture a non-fatal exception with `surface` + `reason` tags. Used
 * by feature code (Senders, Activity, Brief, Autopilot, Sync) to
 * record errors that did not bubble to a React error boundary — e.g.
 * a `useMutation.onError` branch where we already showed a toast but
 * want the Sentry signal.
 */
export function captureFeatureException(
  err: unknown,
  ctx: {
    surface: 'sync' | 'senders' | 'activity' | 'brief' | 'autopilot' | 'triage' | 'onboarding';
    reason: string;
  },
): void {
  if (typeof window === 'undefined') return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag('surface', ctx.surface);
      scope.setTag('reason', ctx.reason);
      Sentry.captureException(err);
    });
  } catch {
    /* SDK not initialised or threw — see jsdoc */
  }
}
