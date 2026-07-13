'use client';

import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '@declutrmail/shared/observability';
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
]);

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
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      tracesSampleRate: 0,
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
        scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
      beforeSendTransaction: () => null,
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
