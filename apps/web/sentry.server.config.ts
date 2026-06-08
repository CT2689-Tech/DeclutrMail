// Sentry server (node-runtime) init for Next.js — D159 + ADR-0021.
// Loaded by `instrumentation.ts` when `process.env.NEXT_RUNTIME === 'nodejs'`.
//
// Privacy posture mirrors sentry.client.config.ts:
//   - tracesSampleRate: 0 (exceptions only)
//   - sendDefaultPii: false
//   - integrations: [] (no auto-instrumentation that could capture
//     request bodies / response bodies / headers beyond the allowlist)
//   - beforeSend + beforeBreadcrumb run through scrubTelemetryPayload
//
// The web tier renders React Server Components, route handlers, and
// some middleware-adjacent code paths. ANY of those could throw with a
// stack frame referencing an internal id or user email. The scrubber
// strips banned-key payloads; the integrations=[] guard prevents
// otel-style auto-capture of arbitrary HTTP req/res shapes.
//
// DSN gate: prefers `SENTRY_DSN` (server-side secret) over the public
// browser DSN. Using a separate server DSN lets the founder route
// server errors to a distinct Sentry project later without touching
// the client config.

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
