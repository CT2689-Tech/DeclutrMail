'use client';

import * as Sentry from '@sentry/nextjs';
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentryTransaction,
} from '@declutrmail/shared/observability';
import type { BrowserSentryRuntime } from './sentry';

/**
 * Heavy browser-only Sentry runtime. This module is reachable exclusively via
 * the DSN-gated dynamic import in `sentry.ts`; do not statically import it from
 * application or instrumentation code.
 *
 * Browser SDK inputs are fail-closed. Only explicitly approved integrations
 * run and both events and manual breadcrumbs are rebuilt by the shared Sentry
 * scrubbers before transport.
 */

let initialized = false;

const SAFE_BROWSER_INTEGRATIONS = new Set([
  'InboundFilters',
  'FunctionToString',
  'GlobalHandlers',
  'LinkedErrors',
  'Dedupe',
  'NextjsClientStackFrameNormalization',
  // Tracing (D159, founder-authorised 2026-08-18). This set is
  // fail-closed by NAME, so a sample rate alone would have been a silent
  // no-op — the integration would still have been filtered out here.
  'BrowserTracing',
]);

/**
 * Parse a `0..1` sample rate, falling back on anything unparseable.
 *
 * Same posture as the API's copy: a malformed or out-of-range value
 * returns the DEFAULT rather than clamping toward 1, because the failure
 * mode of this knob is a quota bill and the safe direction is down.
 */
function readSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

const REACT_INVARIANT = /^Minified React error #(\d{1,4});/u;
const DEV_HYDRATION_FAILURE = /^Hydration failed because /u;

/**
 * Name an uncaught React invariant BEFORE the scrubber erases it.
 *
 * `scrubSentryEvent` drops `exception.value` (D7: `Error.message` can carry
 * user text), and React throws every invariant as a plain `Error`. So a
 * production hydration failure reached Sentry as a message-less `Error`
 * with no tag and no URL — captured, transported, and unfindable: the
 * 2026-09-19 #418 on the public site carried `__sentry_captured__: true`
 * and a search for its message returned nothing.
 *
 * Only the invariant NUMBER is kept, as `react-error-<n>`, in the `reason`
 * tag and the fingerprint the scrubber already allowlists. The rest of
 * the message — including the `args[]` URL — is still dropped. A reason
 * set by a capture site is never overwritten.
 */
function labelReactInvariant(event: Record<string, unknown>): Record<string, unknown> {
  const values = (event.exception as { values?: unknown } | undefined)?.values;
  if (!Array.isArray(values)) return event;

  // Every link of a cause chain, not just the thrown error: a wrapper
  // (`new Error(msg, { cause })`) would otherwise hide the invariant.
  let code: string | undefined;
  for (const entry of values) {
    const value = (entry as { value?: unknown } | null | undefined)?.value;
    if (typeof value !== 'string') continue;
    code =
      REACT_INVARIANT.exec(value)?.[1] ?? (DEV_HYDRATION_FAILURE.test(value) ? '418' : undefined);
    if (code !== undefined) break;
  }
  if (code === undefined) return event;

  const tags = (event.tags ?? {}) as Record<string, unknown>;
  if (tags.reason !== undefined) return event;

  const reason = `react-error-${code}`;
  return {
    ...event,
    tags: { ...tags, reason },
    // A capture site's own grouping wins, same as its reason.
    fingerprint: event.fingerprint ?? [reason],
  };
}

const browserRuntime: BrowserSentryRuntime = {
  addBreadcrumb(crumb): void {
    const breadcrumb = scrubSentryBreadcrumb({
      category: `declutrmail.${crumb.category}`,
      message: crumb.message,
      level: crumb.level === 'warning' ? 'warning' : crumb.level,
      ...(crumb.data === undefined ? {} : { data: crumb.data }),
    });
    if (breadcrumb) {
      Sentry.addBreadcrumb(breadcrumb as Parameters<typeof Sentry.addBreadcrumb>[0]);
    }
  },

  captureFeatureException(error, context): void {
    Sentry.withScope((scope) => {
      scope.setTag('surface', context.surface);
      scope.setTag('reason', context.reason);
      Sentry.captureException(error);
    });
  },

  captureEarlyGlobalException(error, source): void {
    Sentry.captureException(error, {
      mechanism: {
        handled: false,
        type:
          source === 'window-error'
            ? 'auto.browser.global_handlers.onerror'
            : 'auto.browser.global_handlers.onunhandledrejection',
      },
    });
  },

  captureBoundaryException(error, boundary, digest): boolean {
    const client = typeof Sentry.getClient === 'function' ? Sentry.getClient() : undefined;
    if (!client) return false;

    Sentry.captureException(error, {
      tags: { boundary },
      extra: { digest },
    });
    return true;
  },

  captureRouterTransitionStart(href, navigationType): void {
    Sentry.captureRouterTransitionStart(href, navigationType);
  },
};

export function initSentryBrowserRuntime(dsn: string): BrowserSentryRuntime {
  if (!initialized) {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      // Omitted rather than passed empty: an explicit `release` beats
      // the one the Sentry build plugin injects, so stamping a value we
      // invented would override the release the uploaded source maps
      // are actually filed under.
      ...(process.env.NEXT_PUBLIC_SENTRY_RELEASE
        ? { release: process.env.NEXT_PUBLIC_SENTRY_RELEASE }
        : {}),
      // Browser traces show the pageload → navigation → fetch chain behind
      // an error. Shipped behind `beforeSendTransaction` below, which drops
      // every span description (full request URLs live there) and
      // key-allowlists span data.
      tracesSampleRate: readSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.2),
      traceLifecycle: 'static',
      streamGenAiSpans: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      profilesSampleRate: 0,
      profileSessionSampleRate: 0,
      enableLogs: false,
      enableMetrics: false,
      sendClientReports: false,
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        queryParams: false,
        genAI: { inputs: false, outputs: false },
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      integrations: (defaultIntegrations) =>
        defaultIntegrations.filter((integration) =>
          SAFE_BROWSER_INTEGRATIONS.has(integration.name),
        ),
      beforeSend: (event) =>
        scrubSentryEvent(
          labelReactInvariant(event as unknown as Record<string, unknown>),
        ) as unknown as typeof event,
      beforeSendTransaction: (event) =>
        scrubSentryTransaction(event as unknown as Record<string, unknown>) as unknown as
          typeof event | null,
      beforeSendLog: () => null,
      beforeSendMetric: () => null,
      beforeBreadcrumb: (breadcrumb) =>
        scrubSentryBreadcrumb(
          breadcrumb as unknown as Record<string, unknown>,
        ) as unknown as typeof breadcrumb,
    });
    initialized = true;
  }

  return browserRuntime;
}
