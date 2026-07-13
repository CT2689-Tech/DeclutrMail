'use client';

import * as Sentry from '@sentry/nextjs';
import { scrubTelemetryPayload } from '@declutrmail/shared/observability';
import type { BrowserSentryRuntime } from './sentry';

/**
 * Heavy browser-only Sentry runtime. This module is reachable exclusively via
 * the DSN-gated dynamic import in `sentry.ts`; do not statically import it from
 * application or instrumentation code.
 *
 * The init options intentionally preserve the prior configuration. In
 * particular, `integrations: []` adds no custom integrations but does not turn
 * off Sentry's defaults; changing default integrations is a separate privacy
 * and behavior decision.
 */

let initialized = false;

const browserRuntime: BrowserSentryRuntime = {
  addBreadcrumb(crumb): void {
    Sentry.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level === 'warning' ? 'warning' : crumb.level,
      ...(crumb.data === undefined ? {} : { data: crumb.data }),
    });
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
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      sendDefaultPii: false,
      integrations: [],
      beforeSend: (event) =>
        scrubTelemetryPayload(
          event as unknown as Record<string, unknown>,
        ) as unknown as typeof event,
      beforeBreadcrumb: (breadcrumb) =>
        scrubTelemetryPayload(
          breadcrumb as unknown as Record<string, unknown>,
        ) as unknown as typeof breadcrumb,
    });
    initialized = true;
  }

  return browserRuntime;
}
