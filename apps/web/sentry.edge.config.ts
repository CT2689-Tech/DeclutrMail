// Sentry edge-runtime init for Next.js — D159 + ADR-0021.
// Loaded by `instrumentation.ts` when `process.env.NEXT_RUNTIME === 'edge'`.
//
// Edge runtime hosts Next.js Middleware and any route handlers explicitly
// opted into the `edge` runtime. Today the project has neither (every
// route is node-default + middleware does not exist), so this file is
// future-proofing: when an edge route is added, errors there flow
// into Sentry with the same scrubbed shape as server + client.
//
// Same privacy posture as sentry.server.config.ts.

import * as Sentry from '@sentry/nextjs';
import { scrubTelemetryPayload } from '@declutrmail/shared/observability';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
    beforeSend: (event) =>
      scrubTelemetryPayload(event as unknown as Record<string, unknown>) as unknown as typeof event,
    beforeBreadcrumb: (breadcrumb) =>
      scrubTelemetryPayload(
        breadcrumb as unknown as Record<string, unknown>,
      ) as unknown as typeof breadcrumb,
  });
}
